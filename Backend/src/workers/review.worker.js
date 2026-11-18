const mongoose = require("mongoose")
const { randomUUID } = require("node:crypto")
const { Worker, UnrecoverableError } = require("bullmq")
const Review = require("../models/review.model")
const Finding = require("../models/finding.model")
const Project = require("../models/project.model")
const { createRedisConnection } = require("../config/redis")
const { reviewProcessing } = require("../config/review")
const { getReviewSource, getReviewRepository } = require("../services/repository.service")
const { scanWithGitleaks } = require("../services/gitleaks.service")
const { scanWithOsv } = require("../services/osvScanner.service")
const { scanWithSemgrep } = require("../services/semgrep.service")
const { scanWithEslint } = require("../services/eslint.service")
const { reviewJobs, enqueueReview } = require("../services/review.service")
const { prepareImprovementBatches } = require("../services/improvementContext.service")
const { generateImprovements } = require("../services/improvement.service")
const { readImprovementCache, writeImprovementCache, clearImprovementCache } = require("../services/improvementCache.service")
const { generateManualTests } = require("../services/manualTest.service")
const { compareFindings } = require("../services/findingComparison.service")
const { aiConfig } = require("../config/ai")
const { lockfileEcosystems } = require("../config/osvScanner")

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

  worker.on("completed", job => {
    const kind = Object.keys(reviewJobs).find(kind => reviewJobs[kind].name === job.name)

    if (kind && kind !== "review" && !shutdownController.signal.aborted) {
      void enqueueReview(job.data.reviewId, kind).catch(() => {
        console.error("Could not queue the next AI review batch; recovery will retry")
      })
    }
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
    ).select(`+${fields.attempts} +manualTestDescription +improvementCompletedParts +manualTestCompletedParts`).lean()

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

    if (!["entire-project", "latest-changes"].includes(review.mode)) {
      throw new UnrecoverableError("Unsupported review mode")
    }

    let aiPlan = null

    if (kind !== "review") {
      await getReviewRepository(review, signal)
      aiPlan = await readImprovementCache(review, signal)
    }

    const source = aiPlan ? null : await getReviewSource(
      kind === "review" ? review : { ...review, mode: "entire-project" },
      signal,
      updateStage
    )
    signal.throwIfAborted()

    if (kind !== "review") {
      const project = await Project.findOne({
        _id: review.project,
        owner: review.owner
      }).select("description").lean()

      if (!project) {
        throw new UnrecoverableError("Project not found")
      }

      if (!aiPlan) {
        aiPlan = await prepareImprovementBatches(source.files, signal)
        aiPlan.omitted = source.skipped.filter(file => {
          return file.reason !== "ignored-directory" && /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file.path)
        }).map(file => ({ path: file.path, reason: file.reason }))
        await writeImprovementCache(review, aiPlan, signal)
      }

      const plan = aiPlan
      const parts = plan.batches.flat()
      const completed = new Set(review[`${kind}CompletedParts`] || [])
      const batch = plan.batches.find(batch => batch.some(part => !completed.has(part.key)))
      const pending = batch?.filter(part => !completed.has(part.key)) || []
      const manual = kind === "manualTest"
      const generated = manual
        ? await generateManualTests(pending, review.manualTestDescription, signal, review.manualTests.map(test => test.title))
        : await generateImprovements(pending, project.description, signal)
      signal.throwIfAborted()

      for (const part of pending) {
        completed.add(part.key)
      }

      const unique = new Map()

      const previous = manual ? review.manualTests : review.improvements

      for (const item of [...previous, ...generated]) {
        if (!manual && plan.excluded.some(file => file.path === item.filePath)) {
          continue
        }

        const title = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
        const key = manual ? title : JSON.stringify([item.filePath, item.startLine, item.title.trim().toLowerCase()])

        if (!manual || !unique.has(key)) {
          unique.set(key, item)
        }
      }

      const results = [...unique.values()]

      if (!manual) {
        const priorities = ["high", "medium", "low"]
        results.sort((first, second) => {
          return priorities.indexOf(first.priority) - priorities.indexOf(second.priority)
        })
      }

      const completedParts = parts.filter(part => completed.has(part.key))
      const reviewedFiles = [...new Set(parts.map(part => part.path))].filter(filePath => {
        return parts.filter(part => part.path === filePath).every(part => completed.has(part.key))
      })
      const omitted = plan.omitted
      const finished = completedParts.length === parts.length
      const limit = manual ? aiConfig.maxManualTests : aiConfig.maxImprovements
      let message = null

      if (parts.length === 0) {
        message = "No eligible source code was available after file limits and secret checks. No AI review was performed."
      } else if (results.length >= limit) {
        message = `Showing up to ${limit} ${manual ? "manual checks" : "suggestions"}. Code review coverage is shown separately.`
      }

      const result = await Review.updateOne(
        ownedReviewFilter(),
        {
          $set: {
            [manual ? "manualTests" : "improvements"]: results.slice(0, limit),
            [`${kind}Files`]: reviewedFiles,
            [`${kind}CompletedParts`]: completedParts.map(part => part.key),
            [`${kind}Version`]: manual ? aiConfig.manualTestVersion : aiConfig.improvementVersion,
            [`${kind}Coverage`]: {
              eligibleFiles: plan.eligibleFiles + omitted.length,
              reviewedFiles: reviewedFiles.length,
              totalParts: parts.length,
              completedParts: completedParts.length,
              excluded: [...plan.excluded, ...omitted.map(file => ({ path: file.path, reason: file.reason }))]
            },
            [fields.attempts]: 0,
            ...(!manual ? { improvementModel: parts.length > 0 ? aiConfig.model : null } : {}),
            [fields.status]: finished ? "completed" : "pending",
            [`${kind}Message`]: message,
            [fields.token]: null,
            [fields.expires]: null
          }
        },
        { runValidators: true }
      )

      if (!result.matchedCount) {
        throw new Error("AI review processing claim expired")
      }

      if (finished) {
        await clearImprovementCache(review)
      }

      return
    }

    const summary = {
      scanScope: source.scanScope,
      fallbackReason: source.fallbackReason,
      changedFiles: source.changedFiles || [],
      reviewedFiles: source.files.map(file => file.path),
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

    let findings = []
    const scannerOutcomes = []

    for (const scanner of scanners) {
      await updateStage(scanner.stage)
      const result = await scanner.scan(source.files, signal)
      signal.throwIfAborted()
      findings.push(...result.findings)
      scannerOutcomes.push(result.outcome)
    }

    if (review.mode === "latest-changes") {
      findings = await compareFindings(review, findings, scannerOutcomes, source, signal)
    }

    const scopeIncomplete = review.mode === "latest-changes" && source.skipped.some(file => {
      return file.reason !== "ignored-directory" && /\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte)$/.test(file.path)
    })
    const applicable = {
      gitleaks: source.files.length > 0,
      "osv-scanner": source.files.some(file => lockfileEcosystems.has(file.path.split("/").pop())),
      semgrep: source.files.some(file => /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file.path)),
      eslint: source.files.some(file => /\.(js|jsx|mjs|cjs)$/.test(file.path))
    }
    const status = !scopeIncomplete && scannerOutcomes.every(outcome => {
      return outcome.status === "completed" || (
        review.mode === "latest-changes" &&
        outcome.status === "skipped" &&
        applicable[outcome.tool] === false
      )
    })
      ? "completed"
      : "partial"

    const findingCounts = {
      new: findings.filter(finding => finding.changeStatus === "new").length,
      existing: findings.filter(finding => finding.changeStatus === "existing").length,
      resolved: findings.filter(finding => finding.changeStatus === "resolved").length
    }

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
            findingCounts,
            resultMessage: status === "completed"
              ? "All configured scanners completed. Review the findings and coverage details."
              : "Some checks failed, were skipped or could not cover all selected source files. Carried findings were retained where checks could not finish.",
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

    if (["AI_HIGH_DEMAND", "AI_RATE_LIMIT", "AI_INVALID_RESPONSE", "AI_RESPONSE_TOO_LONG"].includes(error.code)) {
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
  if (error.publicMessage && [409, 422].includes(error.status) && error.code !== "GITHUB_RECONNECT") {
    return {
      code: "REVIEW_SCOPE_UNAVAILABLE",
      message: error.publicMessage
    }
  }

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
