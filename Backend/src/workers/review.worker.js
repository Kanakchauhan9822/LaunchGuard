const mongoose = require("mongoose")
const { randomUUID } = require("node:crypto")
const { Worker, UnrecoverableError } = require("bullmq")
const Review = require("../models/review.model")
const Finding = require("../models/finding.model")
const Project = require("../models/project.model")
const { createRedisConnection } = require("../config/redis")
const { reviewProcessing } = require("../config/review")
const { getReviewSource } = require("../services/repository.service")
const { scanWithGitleaks } = require("../services/gitleaks.service")
const { scanWithOsv } = require("../services/osvScanner.service")
const { scanWithSemgrep } = require("../services/semgrep.service")
const { scanWithEslint } = require("../services/eslint.service")
const { reviewJobs } = require("../services/review.service")
const { selectImprovementFiles } = require("../services/improvementContext.service")
const { generateImprovements } = require("../services/improvement.service")
const { generateManualTests } = require("../services/manualTest.service")
const { aiConfig } = require("../config/ai")

const scanners = [
  { tool: "gitleaks", stage: "scanning-secrets", scan: scanWithGitleaks },
  { tool: "osv-scanner", stage: "scanning-dependencies", scan: scanWithOsv },
  { tool: "semgrep", stage: "scanning-code", scan: scanWithSemgrep },
  { tool: "eslint", stage: "scanning-quality", scan: scanWithEslint }
]

function startReviewWorker() {
  const connection = createRedisConnection({ forWorker: true })
  const shutdownController = new AbortController()

  const worker = new Worker(
    "reviews",
    job => processReview(job, shutdownController.signal),
    {
      connection,
      concurrency: 1,
      maxStalledCount: 2
    }
  )

  worker.on("error", () => {
    console.error("Review worker connection or processing error")
  })

  worker.on("failed", () => {
    console.error("Review job attempt failed; retry or recovery will reconcile its status")
  })

  return async function stopReviewWorker() {
    const closing = worker.close()
    shutdownController.abort()

    try {
      await closing
    } finally {
      connection.disconnect()
    }
  }
}

async function processReview(job, shutdownSignal) {
  const reviewId = job.data?.reviewId
  const kind = Object.keys(reviewJobs).find(kind => reviewJobs[kind].name === job.name)
  const fields = reviewJobs[kind]

  if (
    !fields ||
    typeof reviewId !== "string" ||
    !mongoose.isObjectIdOrHexString(reviewId) ||
    job.id !== `${fields.prefix}-${reviewId}`
  ) {
    throw new UnrecoverableError("Invalid review job")
  }

  const token = randomUUID()
  const now = new Date()
  let review

  try {
    review = await Review.findOneAndUpdate(
      {
        _id: reviewId,
        $and: [
          {
            $or: [
              { [fields.status]: { $in: ["pending", "queued"] } },
              { [fields.status]: "running", [fields.expires]: { $lte: now } },
              { [fields.status]: "running", [fields.expires]: null }
            ]
          },
          {
            $or: [
              { [fields.attempts]: { $lt: reviewProcessing.maxAttempts } },
              { [fields.attempts]: { $exists: false } }
            ]
          }
        ]
      },
      {
        $set: {
          [fields.status]: "running",
          [fields.token]: token,
          [fields.expires]: new Date(Date.now() + reviewProcessing.leaseMs),
          ...(kind !== "review" ? {
            [kind === "manualTest" ? "manualTestMessage" : "improvementMessage"]: null
          } : {
            stage: "checking-access",
            failure: null,
            resultMessage: null
          })
        },
        $inc: { [fields.attempts]: 1 }
      },
      { returnDocument: "after", runValidators: true }
    ).select(`+${fields.attempts} +manualTestDescription`).lean()

    if (!review) {
      const existing = await Review.findById(reviewId).select(fields.status).lean()

      if (!existing || ["partial", "completed", "failed"].includes(existing[fields.status])) {
        return
      }

      throw new Error("Review is already being processed or has exhausted its attempts")
    }
  } catch {
    throw new Error("Could not claim review processing")
  }

  const signal = AbortSignal.any([
    shutdownSignal,
    AbortSignal.timeout(reviewProcessing.timeoutMs)
  ])

  function ownedReviewFilter() {
    return {
      _id: reviewId,
      [fields.status]: "running",
      [fields.token]: token,
      [fields.expires]: { $gt: new Date() }
    }
  }

  async function updateStage(stage) {
    signal.throwIfAborted()

    if (kind !== "review") {
      return
    }

    const result = await Review.updateOne(
      ownedReviewFilter(),
      { $set: { stage } },
      { runValidators: true }
    )

    if (!result.matchedCount) {
      throw new Error("Review processing claim expired")
    }
  }

  try {
    signal.throwIfAborted()

    if (review.mode !== "entire-project") {
      throw new UnrecoverableError("Unsupported review mode")
    }

    const source = await getReviewSource(review, signal, updateStage)
    signal.throwIfAborted()

    if (kind === "manualTest") {
      const files = await selectImprovementFiles(source.files, signal)
      const manualTests = await generateManualTests(files, review.manualTestDescription, signal)
      signal.throwIfAborted()

      const result = await Review.updateOne(
        ownedReviewFilter(),
        {
          $set: {
            manualTests,
            manualTestFiles: files.map(file => file.path),
            manualTestStatus: "completed",
            manualTestMessage: files.length === 0
              ? "No source files were available within the size and secret-check limits. No manual checks were generated."
              : null,
            manualTestToken: null,
            manualTestExpiresAt: null
          }
        },
        { runValidators: true }
      )

      if (!result.matchedCount) {
        throw new Error("Manual check processing claim expired")
      }

      return
    }

    if (kind === "improvement") {
      const project = await Project.findOne({
        _id: review.project,
        owner: review.owner
      }).select("description").lean()

      if (!project) {
        throw new UnrecoverableError("Project not found")
      }

      const files = await selectImprovementFiles(source.files, signal)
      const improvements = await generateImprovements(files, project.description, signal)
      signal.throwIfAborted()
      const priorities = ["high", "medium", "low"]
      improvements.sort((first, second) => {
        return priorities.indexOf(first.priority) - priorities.indexOf(second.priority)
      })

      const result = await Review.updateOne(
        ownedReviewFilter(),
        {
          $set: {
            improvements,
            improvementFiles: files.map(file => file.path),
            improvementModel: files.length > 0 ? aiConfig.model : null,
            improvementStatus: "completed",
            improvementMessage: files.length === 0
              ? "No source files were available within the size and secret-check limits. No AI review was performed."
              : null,
            improvementToken: null,
            improvementExpiresAt: null
          }
        },
        { runValidators: true }
      )

      if (!result.matchedCount) {
        throw new Error("Suggestion processing claim expired")
      }

      return
    }

    const summary = {
      repositoryAnalysis: source.inspection,
      coverage: {
        treeEntryCount: source.treeEntryCount,
        retainedFileCount: source.files.length,
        downloadedBytes: source.downloadedBytes,
        selectedBytes: source.selectedBytes,
        skipped: source.skipped
      }
    }

    if (Buffer.byteLength(JSON.stringify(summary), "utf8") > reviewProcessing.maxSummaryBytes) {
      throw new UnrecoverableError("Repository summary exceeds storage limits")
    }

    const findings = []
    const scannerOutcomes = []

    for (const scanner of scanners) {
      await updateStage(scanner.stage)
      const result = await scanner.scan(source.files, signal)
      signal.throwIfAborted()
      findings.push(...result.findings)
      scannerOutcomes.push(result.outcome)
    }

    const status = scannerOutcomes.every(outcome => outcome.status === "completed")
      ? "completed"
      : "partial"

    await Review.db.transaction(async session => {
      signal.throwIfAborted()
      const claim = await Review.updateOne(
        ownedReviewFilter(),
        { $set: { stage: "scans-finished" } },
        { session, runValidators: true }
      )

      if (!claim.matchedCount) {
        throw new Error("Review processing claim expired")
      }

      await Finding.deleteMany(
        {
          review: reviewId,
          tool: {
            $in: scanners.map(scanner => scanner.tool)
          }
        },
        { session }
      )

      if (findings.length > 0) {
        await Finding.insertMany(
          findings.map(finding => ({
            ...finding,
            review: reviewId
          })),
          { session }
        )
      }

      signal.throwIfAborted()
      const result = await Review.updateOne(
        ownedReviewFilter(),
        {
          $set: {
            ...summary,
            status,
            stage: "scans-finished",
            scannerOutcomes,
            resultMessage: status === "completed"
              ? "All configured scanners completed. Review the findings and coverage details."
              : "Some configured scanners failed or were skipped. Check individual scanner outcomes for details.",
            failure: null,
            processingToken: null,
            processingExpiresAt: null
          }
        },
        { session, runValidators: true }
      )

      if (!result.matchedCount) {
        throw new Error("Review processing claim expired")
      }
      signal.throwIfAborted()
    })
  } catch (error) {
    const permanent = (
      error instanceof UnrecoverableError ||
      error.name === "ValidationError" ||
      [400, 401, 403, 404, 409, 422].includes(error.status)
    )
    const exhausted = (
      review[fields.attempts] >= reviewProcessing.maxAttempts ||
      job.attemptsMade + 1 >= (job.opts.attempts || 1)
    )
    const terminal = permanent || exhausted
    const failure = getSafeFailure(error)
    let improvementMessage = "Generation could not finish. Please try again."

    if (failure.code === "GITHUB_RECONNECT") {
      improvementMessage = "Reconnect GitHub before trying again."
    }

    if (["AI_HIGH_DEMAND", "AI_RATE_LIMIT", "AI_INVALID_RESPONSE"].includes(error.code)) {
      improvementMessage = error.publicMessage
    }

    try {
      await Review.updateOne(
        ownedReviewFilter(),
        {
          $set: {
            [fields.status]: terminal ? "failed" : "queued",
            [fields.token]: null,
            [fields.expires]: null,
            ...(kind !== "review" ? {
              [kind === "manualTest" ? "manualTestMessage" : "improvementMessage"]: improvementMessage
            } : {
              stage: "waiting",
              failure
            })
          }
        },
        { runValidators: true }
      )
    } catch {
      console.error("Could not persist review failure; recovery is required")
    }

    if (terminal) {
      throw new UnrecoverableError(failure.message)
    }

    throw new Error(failure.message)
  }
}

function getSafeFailure(error) {
  if (error.code === "GITHUB_RECONNECT" || error.status === 401) {
    return {
      code: "GITHUB_RECONNECT",
      message: "Reconnect GitHub before requesting another review."
    }
  }

  if (error.status === 403 || error.status === 404) {
    return {
      code: "REPOSITORY_UNAVAILABLE",
      message: "The project, repository or saved commit is no longer accessible."
    }
  }

  if (error.status === 422) {
    return {
      code: "REPOSITORY_LIMIT",
      message: "Repository preparation could not continue within the supported file and size limits."
    }
  }

  return {
    code: "REPOSITORY_PREPARATION_FAILED",
    message: "Repository preparation could not finish. A temporary service failure or processing limit may have interrupted it."
  }
}

module.exports = {
  startReviewWorker
}
