const Redis = require("ioredis")

function createRedisConnection({ forWorker = false } = {}) {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    throw new Error("REDIS_URL is required")
  }

  let parsed

  try {
    parsed = new URL(redisUrl)
  } catch {
    throw new Error("REDIS_URL must be a valid Redis connection URL")
  }

  if (!["redis:", "rediss:"].includes(parsed.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://")
  }

  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: forWorker ? null : 1,
    connectTimeout: 10000,
    ...(!forWorker ? { commandTimeout: 10000 } : {})
  })

  connection.on("error", () => {
    console.error("Redis connection error")
  })

  return connection
}

module.exports = {
  createRedisConnection
}
