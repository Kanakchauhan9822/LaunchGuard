const Review = require("../models/review.model")
const { reviewQueue, withReviewQueue } = require("../queues/review.queue")

async function enqueueReview(reviewId) {
  const id = reviewId.toString()

  const review = await Review.findOne({
    _id: reviewId,
    status: { $in: ["pending", "queued"] }
  }).lean()

  if (!review) {
    return null
  }

  await withReviewQueue(() => reviewQueue.add(
    "scan-project",
    {
      reviewId: id
    },
    {
      jobId: `review-${id}`
    }
  ))

  return Review.findOneAndUpdate(
    {
      _id: reviewId,
      status: "pending"
    },
    {
      $set: {
        status: "queued"
      }
    },
    {
      new: true
    }
  )
}

async function recoverPendingReviews(cursor = null, shouldStop = () => false) {
  const cutoff = new Date(Date.now() - 30000)

  const filter = {
    status: { $in: ["pending", "queued"] },
    updatedAt: {
      $lte: cutoff
    }
  }

  if (cursor) {
    filter._id = { $gt: cursor }
  }

  const reviews = await Review.find(filter)
    .select("_id status")
    .sort({ _id: 1 })
    .limit(20)
    .lean()

  for (const review of reviews) {
    if (shouldStop()) {
      return cursor
    }

    try {
      const job = await withReviewQueue(() => reviewQueue.getJob(`review-${review._id}`))

      if (!job || review.status === "pending") {
        await enqueueReview(review._id)
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

  async function runRecovery() {
    try {
      cursor = await recoverPendingReviews(cursor, () => stopped)
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
  enqueueReview,
  recoverPendingReviews,
  startReviewRecovery
}
