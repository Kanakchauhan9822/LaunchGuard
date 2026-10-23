const { Queue } = require("bullmq")
const { createRedisConnection } = require("../config/redis")
const { reviewProcessing } = require("../config/review")

const connection = createRedisConnection()

const reviewQueue = new Queue("reviews", {
  connection,
  defaultJobOptions: {
    attempts: reviewProcessing.maxAttempts,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: {
      count: 100
    },
    removeOnFail: {
      count: 100
    }
  }
})

reviewQueue.on("error", () => {
  console.error("Review queue error")
})

async function withReviewQueue(operation) {
  if (connection.status !== "ready") {
    throw new Error("Review queue is unavailable")
  }

  let timer

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Review queue timed out")), 10000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function closeReviewQueue() {
  try {
    await reviewQueue.close()
  } finally {
    connection.disconnect()
  }
}

module.exports = {
  reviewQueue,
  withReviewQueue,
  closeReviewQueue
}
