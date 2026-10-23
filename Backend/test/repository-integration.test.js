const { test } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")

test("isolated MongoDB and Redis: duplicates, worker persistence and graceful retry", {
  skip: process.env.RUN_LIVE_VERIFICATION !== "1",
  timeout: 55000
}, async () => {
  require("dotenv").config({ quiet: true })
  const mongoose = require("mongoose")
  const { Queue, Worker, UnrecoverableError } = require("bullmq")
  const { createRedisConnection } = require("../src/config/redis")
  const Review = require("../src/models/review.model")
  const { inspectRepository } = require("../src/services/repositoryInspection.service")
  const suffix = randomUUID().replaceAll("-", "")
  const collectionName = `launchguard_verification_${suffix}`
  const queueName = `launchguard-verification-${suffix}`
  let queue
  let queueConnection
  let stop
  let createdCollection = false
  let block = false
  let started
  let calls = 0
  const database = await mongoose.createConnection(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000
  }).asPromise()
  const TestReview = database.model("VerificationReview", Review.schema.clone(), collectionName)

  async function waitFor(callback) {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const value = await callback()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error("Verification condition timed out")
  }

  try {
    await TestReview.init()
    createdCollection = true
    const data = {
      owner: new mongoose.Types.ObjectId(),
      project: new mongoose.Types.ObjectId(),
      mode: "entire-project",
      commitSha: "a".repeat(40),
      status: "queued"
    }
    const submissions = await Promise.allSettled(Array.from({ length: 6 }, () => TestReview.create(data)))
    const accepted = submissions.filter(result => result.status === "fulfilled")
    assert.equal(accepted.length, 1)
    assert.equal(submissions.filter(result => result.status === "rejected" && result.reason.code === 11000).length, 5)
    console.log("PASS: MongoDB concurrent active-review uniqueness")

    queueConnection = createRedisConnection()
    queue = new Queue(queueName, { connection: queueConnection })
    await queue.waitUntilReady()
    class IsolatedWorker extends Worker {
      constructor(name, processor, options) {
        super(queueName, processor, options)
      }
    }
    const filename = path.resolve(__dirname, "../src/workers/review.worker.js")
    const instance = new Module(filename, module)
    instance.filename = filename
    instance.paths = Module._nodeModulePaths(path.dirname(filename))
    const original = instance.require.bind(instance)
    const mocks = {
      bullmq: { Worker: IsolatedWorker, UnrecoverableError },
      "../models/review.model": TestReview,
      "../services/repository.service": {
        getReviewSource: async (review, signal, stage) => {
          calls++
          await stage("fetching-files")
          if (block) {
            started()
            await new Promise((resolve, reject) => {
              if (signal.aborted) return reject(new Error("Stopped"))
              signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true })
            })
          }
          await stage("inspecting-repository")
          const files = [{ path: "package.json", content: '{"dependencies":{"express":"^5"}}' }]
          return {
            files,
            inspection: inspectRepository(files, []),
            treeEntryCount: 1,
            downloadedBytes: files[0].content.length,
            selectedBytes: files[0].content.length,
            skipped: []
          }
        }
      }
    }
    instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name)
    instance._compile(fs.readFileSync(filename, "utf8"), filename)
    const start = instance.exports.startReviewWorker
    const first = accepted[0].value
    const add = review => queue.add("scan-project", { reviewId: String(review._id) }, {
      jobId: `review-${review._id}`,
      attempts: 3,
      backoff: { type: "fixed", delay: 100 }
    })
    await Promise.all([add(first), add(first), add(first)])
    stop = start()
    const saved = await waitFor(async () => {
      const review = await TestReview.findById(first._id).lean()
      return review.status === "partial" ? review : null
    })
    assert.equal(calls, 1)
    assert.equal(saved.repositoryAnalysis.packages[0].technologies[0].name, "Express")
    assert.equal(saved.coverage.retainedFileCount, 1)
    assert.equal(saved.failure, null)
    assert.equal(saved.processingToken, undefined)
    console.log("PASS: Redis job deduplication and real worker summary persistence")

    await stop()
    stop = null
    stop = start()
    const persisted = await TestReview.findById(first._id).lean()
    assert.equal(persisted.status, "partial")
    assert.equal(persisted.repositoryAnalysis.packages.length, 1)
    assert.equal(await TestReview.countDocuments(), 1)
    console.log("PASS: completed preparation survives worker restart")

    block = true
    const entered = new Promise(resolve => { started = resolve })
    const second = await TestReview.create(data)
    await add(second)
    await Promise.race([
      entered,
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker did not start")), 12000)
        timer.unref()
      })
    ])
    await stop()
    stop = null
    const interrupted = await TestReview.findById(second._id).lean()
    assert.equal(interrupted.status, "queued")
    block = false
    stop = start()
    await waitFor(async () => (await TestReview.findById(second._id).lean()).status === "partial")
    assert.equal(await TestReview.countDocuments(), 2)
    console.log("PASS: interrupted preparation retries successfully after worker restart")
  } finally {
    if (stop) await stop()
    if (queue) {
      assert.match(queueName, /^launchguard-verification-[a-f0-9]{32}$/)
      await queue.obliterate({ force: true })
      await queue.close()
    }
    queueConnection?.disconnect()
    if (createdCollection) {
      assert.match(collectionName, /^launchguard_verification_[a-f0-9]{32}$/)
      await TestReview.collection.drop()
    }
    await database.close()
    console.log("Temporary verification queue and collection cleaned up")
  }
})
