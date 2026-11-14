const mongoose = require("mongoose")
const { randomUUID } = require("node:crypto")
const { Worker, UnrecoverableError } = require("bullmq")
const Review = require("../models/review.model")
const Finding = require("../models/finding.model")
const { createRedisConnection } = require("../config/redis")
const { reviewProcessing } = require("../config/review")
const { getReviewSource } = require("../services/repository.service")
const { scanWithGitleaks } = require("../services/gitleaks.service")
const { scanWithOsv } = require("../services/osvScanner.service")
const { scanWithSemgrep } = require("../services/semgrep.service")
const { scanWithEslint } = require("../services/eslint.service")

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

  if (
    job.name !== "scan-project" ||
    typeof reviewId !== "string" ||
    !mongoose.isObjectIdOrHexString(reviewId) ||
    job.id !== `review-${reviewId}`
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
              { status: { $in: ["pending", "queued"] } },
              { status: "running", processingExpiresAt: { $lte: now } },
              { status: "running", processingExpiresAt: null }
            ]
          },
          {
            $or: [
              { processingAttempts: { $lt: reviewProcessing.maxAttempts } },
              { processingAttempts: { $exists: false } }
            ]
          }
        ]
      },
      {
        $set: {
          status: "running",
          stage: "checking-access",
          processingToken: token,
          processingExpiresAt: new Date(Date.now() + reviewProcessing.leaseMs),
          failure: null,
          resultMessage: null
        },
        $inc: { processingAttempts: 1 }
      },
      { returnDocument: "after", runValidators: true }
    ).select("+processingAttempts").lean()

    if (!review) {
      const existing = await Review.findById(reviewId).select("status").lean()

      if (!existing || ["partial", "completed", "failed"].includes(existing.status)) {
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
      status: "running",
      processingToken: token,
      processingExpiresAt: { $gt: new Date() }
    }
  }

  async function updateStage(stage) {
    signal.throwIfAborted()

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
      review.processingAttempts >= reviewProcessing.maxAttempts ||
      job.attemptsMade + 1 >= (job.opts.attempts || 1)
    )
    const terminal = permanent || exhausted
    const failure = getSafeFailure(error)

    try {
      await Review.updateOne(
        ownedReviewFilter(),
        {
          $set: {
            status: terminal ? "failed" : "queued",
            stage: "waiting",
            failure,
            processingToken: null,
            processingExpiresAt: null
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
