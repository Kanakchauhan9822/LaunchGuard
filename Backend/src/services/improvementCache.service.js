const { createHash, randomUUID } = require("node:crypto")
const { gzipSync, gunzipSync } = require("node:zlib")
const { aiConfig } = require("../config/ai")
const { encryptToken, decryptToken } = require("./token.service")
const { reviewRedis: client, withReviewQueue } = require("../queues/review.queue")

const chunkBytes = 256 * 1024
const maxPlaintextBytes = 64 * 1024 * 1024

function cacheKey(review) {
  const identity = [review.owner, review.project, review._id, review.commitSha, aiConfig.improvementVersion]
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex")
  return `launchguard:improvement-context:${hash}`
}

async function readImprovementCache(review, signal) {
  const key = cacheKey(review)

  try {
    signal?.throwIfAborted()
    return await withReviewQueue(async () => {
      const length = await client.llen(key)

      if (!length || length > Math.ceil(aiConfig.maxImprovementCacheBytes / chunkBytes)) {
        return null
      }

      const chunks = []

      for (let index = 0; index < length; index += 2) {
        signal?.throwIfAborted()
        chunks.push(...await client.lrange(key, index, index + 1))
      }

      const encrypted = chunks.join("")

      if (encrypted.length > aiConfig.maxImprovementCacheBytes) {
        return null
      }

      const compressed = Buffer.from(decryptToken(encrypted), "base64")
      const data = JSON.parse(gunzipSync(compressed, { maxOutputLength: maxPlaintextBytes }).toString("utf8"))

      if (
        data.identity !== key ||
        !Array.isArray(data.plan?.batches) ||
        !Array.isArray(data.plan.excluded) ||
        !Array.isArray(data.plan.omitted) ||
        !Number.isSafeInteger(data.plan.eligibleFiles)
      ) {
        return null
      }

      await client.expire(key, aiConfig.improvementCacheTtlSeconds)
      return data.plan
    })
  } catch {
    signal?.throwIfAborted()
    return null
  }
}

async function writeImprovementCache(review, plan, signal) {
  const key = cacheKey(review)
  const stagingKey = `${key}:${randomUUID()}`

  try {
    signal?.throwIfAborted()
    const plaintext = JSON.stringify({ identity: key, plan })

    if (Buffer.byteLength(plaintext, "utf8") > maxPlaintextBytes) {
      return
    }

    const encrypted = encryptToken(gzipSync(plaintext).toString("base64"))

    if (encrypted.length > aiConfig.maxImprovementCacheBytes) {
      return
    }

    await withReviewQueue(async () => {
      for (let offset = 0; offset < encrypted.length; offset += chunkBytes) {
        signal?.throwIfAborted()
        const results = await client.multi()
          .rpush(stagingKey, encrypted.slice(offset, offset + chunkBytes))
          .expire(stagingKey, aiConfig.improvementCacheTtlSeconds)
          .exec()

        if (!results || results.some(([error]) => error)) {
          throw new Error("Could not cache coding-review context")
        }
      }

      signal?.throwIfAborted()
      await client.rename(stagingKey, key)
    })
  } catch {
    signal?.throwIfAborted()
  }
}

async function clearImprovementCache(review) {
  await withReviewQueue(async () => {
    await client.del(cacheKey(review))
  }).catch(() => {})
}

module.exports = {
  readImprovementCache,
  writeImprovementCache,
  clearImprovementCache
}
