const Review = require("../models/review.model")
const { reviewQueue, withReviewQueue } = require("../queues/review.queue")
const { reviewProcessing } = require("../config/review")

const reviewJobs = {
  review: {
    name: "scan-project",
    prefix: "review",
    status: "status",
    token: "processingToken",
    expires: "processingExpiresAt",
    attempts: "processingAttempts"
  },
  manualTest: {
    name: "generate-manual-tests",
    prefix: "manual-test",
    status: "manualTestStatus",
    token: "manualTestToken",
    expires: "manualTestExpiresAt",
    attempts: "manualTestAttempts"
  },
  improvement: {
    name: "suggest-improvements",
    prefix: "improvement",
    status: "improvementStatus",
    token: "improvementToken",
    expires: "improvementExpiresAt",
    attempts: "improvementAttempts"
  }
}

async function enqueueReview(reviewId, kind = "review") {
  const id = reviewId.toString()
  const fields = reviewJobs[kind]

  const review = await Review.findOne({
    _id: reviewId,
    [fields.status]: { $in: ["pending", "queued"] }
  }).lean()

  if (!review) {
    return null
  }

  const jobId = `${fields.prefix}-${id}`

  if (kind !== "review") {
    const previous = await withReviewQueue(() => reviewQueue.getJob(jobId))

    if (previous) {
      const state = await withReviewQueue(() => previous.getState())

      if (["completed", "failed"].includes(state)) {
        await withReviewQueue(() => previous.remove())
      }
    }
  }

  await withReviewQueue(() => reviewQueue.add(
    fields.name,
    {
      reviewId: id
    },
    {
      jobId
    }
  ))

  return Review.findOneAndUpdate(
    {
      _id: reviewId,
      [fields.status]: "pending"
    },
    {
      $set: {
        [fields.status]: "queued"
      }
    },
    {
      returnDocument: "after"
    }
  )
}

async function recoverPendingReviews(cursor = null, shouldStop = () => false, kind = "review") {
  const cutoff = new Date(Date.now() - 30000)
  const fields = reviewJobs[kind]

  const filter = {
    $or: [
      { [fields.status]: { $in: ["pending", "queued"] } },
      { [fields.status]: "running", [fields.expires]: { $lte: new Date() } },
      { [fields.status]: "running", [fields.expires]: null }
    ],
    updatedAt: {
      $lte: cutoff
    }
  }

  if (cursor) {
    filter._id = { $gt: cursor }
  }

  const reviews = await Review.find(filter)
    .select(`_id ${fields.status} updatedAt +${fields.attempts}`)
    .sort({ _id: 1 })
    .limit(20)
    .lean()

  for (const review of reviews) {
    if (shouldStop()) {
      return cursor
    }

    try {
      const job = await withReviewQueue(() => reviewQueue.getJob(`${fields.prefix}-${review._id}`))
      const jobState = job
        ? await withReviewQueue(() => job.getState())
        : "missing"

      const attemptsExhausted = review[fields.attempts] >= reviewProcessing.maxAttempts

      if (kind !== "review" && review[fields.status] === "pending" && !attemptsExhausted) {
        await enqueueReview(review._id, kind)
        cursor = review._id
        continue
      }

      const abandoned = (
        jobState === "failed" ||
        jobState === "completed" ||
        (jobState === "missing" && review[fields.status] === "running") ||
        (jobState !== "active" && attemptsExhausted)
      )

      if (abandoned) {
        await Review.updateOne(
          {
            _id: review._id,
            [fields.status]: review[fields.status],
            updatedAt: review.updatedAt
          },
          {
            $set: {
              [fields.status]: "failed",
              [fields.token]: null,
              [fields.expires]: null,
              ...(kind !== "review" ? {
                [kind === "manualTest" ? "manualTestMessage" : "improvementMessage"]: "Generation was interrupted. Please try again."
              } : {
                failure: {
                  code: "REVIEW_INTERRUPTED",
                  message: "Review processing stopped before saving a result. Please request a new review."
                }
              })
            }
          },
          { runValidators: true }
        )
      } else if (!job || review[fields.status] === "pending") {
        await enqueueReview(review._id, kind)
      }

      cursor = review._id
    } catch {
      console.error("Review queue recovery could not finish")
      return cursor
    }
  }

  return reviews.length === 20 ? cursor : null
}


function startReviewRecovery() {
  let stopped = false
  let timer
  let activeRun = Promise.resolve()
  let cursor = null
  let improvementCursor = null
  let manualTestCursor = null

  async function runRecovery() {
    try {
      cursor = await recoverPendingReviews(cursor, () => stopped)
      improvementCursor = await recoverPendingReviews(improvementCursor, () => stopped, "improvement")
      manualTestCursor = await recoverPendingReviews(manualTestCursor, () => stopped, "manualTest")
    } catch {
      console.error("Review recovery failed")
    } finally {
      if (!stopped) {
        timer = setTimeout(startRun, 60000)
        timer.unref()
      }
    }
  }

  function startRun() {
    if (!stopped) {
      activeRun = runRecovery()
    }
  }

  startRun()

  return async function stopReviewRecovery() {
    stopped = true
    clearTimeout(timer)
    await activeRun
  }
}


module.exports = {
  reviewJobs,
  enqueueReview,
  recoverPendingReviews,
  startReviewRecovery
}
