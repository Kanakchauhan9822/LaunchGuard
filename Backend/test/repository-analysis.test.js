const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const { inspectRepository } = require("../src/services/repositoryInspection.service")
const { selectRepositoryFiles } = require("../src/services/repositoryFiles.service")
const Review = require("../src/models/review.model")
const { createHash } = require("node:crypto")

function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative)
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = instance.require.bind(instance)
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name)
  instance._compile(fs.readFileSync(filename, "utf8"), filename)
  return instance.exports
}

function entry(filePath, extra = {}) {
  return {
    path: filePath,
    type: "blob",
    mode: "100644",
    size: 5,
    sha: "a".repeat(40),
    ...extra
  }
}

test("inspection detects declared technologies and manager conflicts by directory", () => {
  const result = inspectRepository([
    {
      path: "Backend/package.json",
      content: JSON.stringify({ dependencies: { express: "^5", ioredis: "^5", bullmq: "^6", ws: "^8" } })
    },
    { path: "bad/package.json", content: "{" },
    { path: "array/package.json", content: "[]" },
    { path: "invalid/package.json", content: '{"dependencies":[],"devDependencies":{"react":42}}' }
  ], [
    entry("Backend/package-lock.json"),
    entry("Backend/npm-shrinkwrap.json"),
    entry("Frontend/bun.lockb"),
    entry("Frontend/yarn.lock"),
    entry("node_modules/x/yarn.lock"),
    entry("../yarn.lock"),
    entry("linked/yarn.lock", { mode: "120000" })
  ])
  assert.equal(result.packages[0].technologies.length, 4)
  assert.equal(result.packageManagers.length, 4)
  assert.equal(result.warnings.filter(w => w.reason === "conflicting-package-manager-lockfiles").length, 1)
  assert.equal(result.warnings.length, 5)
  assert.equal(result.packageManagers.find(p => p.manager === "bun").path, "Frontend/bun.lockb")
})

test("selector excludes unsafe paths, dependencies, links and oversized files", () => {
  const result = selectRepositoryFiles([
    entry("app.js"), entry("../bad.js"), entry("node_modules/a.js"),
    entry("link", { mode: "120000" }), entry("photo.png"),
    entry("large.js", { size: 1024 * 1024 + 1 })
  ])
  assert.equal(result.files.length, 1)
  assert.equal(result.skipped.length, 5)
  assert.throws(() => selectRepositoryFiles([entry("a.js"), entry("a.js")]))
  assert.throws(() => selectRepositoryFiles([entry("a.js", { sha: "bad" })]))
})

test("blob reader verifies bytes and SHA and sanitizes GitHub errors", async context => {
  const service = load("../src/services/github.service.js", {
    "../models/user.model": {
      findOne: () => ({ select: async () => ({ githubToken: "encrypted-fixture" }) })
    },
    "./token.service": { decryptToken: () => "fixture-token" }
  })
  const content = Buffer.from("hello")
  const sha = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex")
  const read = await service.createRepositoryBlobReader(id, "fixture", { fullName: "owner/repo" })
  context.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.redirect, "error")
    return new Response(content)
  })
  let bytes = 0
  assert.deepEqual(await read({ sha, size: 5 }, new AbortController().signal, size => { bytes += size }), content)
  assert.equal(bytes, 5)
  await assert.rejects(read({ sha: "b".repeat(40), size: 5 }, new AbortController().signal, () => {}), /blob SHA/)
  await assert.rejects(read({ sha, size: 4 }, new AbortController().signal, () => {}), /allowed size/)
  globalThis.fetch.mock.mockImplementation(async () => new Response("private body", { status: 401 }))
  await assert.rejects(read({ sha, size: 5 }, new AbortController().signal, () => {}), error => {
    assert.equal(error.code, "GITHUB_RECONNECT")
    assert.equal(error.message.includes("private body"), false)
    return true
  })
})

test("downloader skips binary, invalid UTF-8 and LFS without exceeding concurrency", async () => {
  const { downloadRepositoryFiles } = require("../src/services/repositoryDownload.service")
  const contents = [Buffer.from("hello"), Buffer.from([0]), Buffer.from([255]), Buffer.from("version https://git-lfs.github.com/spec/v1\n")]
  let active = 0
  let peak = 0
  const result = await downloadRepositoryFiles({
    files: contents.map((value, index) => entry(String(index))),
    skipped: [], totalBytes: 100, treeEntryCount: 4
  }, async (file, signal, account) => {
    active++
    peak = Math.max(active, peak)
    await new Promise(resolve => setImmediate(resolve))
    active--
    const content = contents[Number(file.path)]
    account(content.length)
    return content
  })
  assert.equal(peak, 2)
  assert.equal(result.files.length, 1)
  assert.equal(result.skipped.length, 3)
  assert.equal(result.downloadedBytes, contents.reduce((sum, value) => sum + value.length, 0))
  await assert.rejects(downloadRepositoryFiles({ files: [], skipped: [] }, async () => {}, AbortSignal.abort()))
})

function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$and") return value.every(item => matches(document, item))
    if (key === "$or") return value.some(item => matches(document, item))
    const actual = document[key]
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === "$in") return expected.includes(actual)
        if (operator === "$lt") return actual < expected
        if (operator === "$lte") return actual <= expected
        if (operator === "$gt") return actual > expected
        if (operator === "$exists") return (actual !== undefined) === expected
        return false
      })
    }
    if (value === null) return actual == null
    if (value instanceof Date) return +actual === +value
    return String(actual) === String(value)
  })
}

function query(value) {
  return {
    select() { return this },
    sort() { return this },
    limit() { return this },
    async lean() { return value }
  }
}

const id = "000000000000000000000001"
const source = {
  inspection: { packages: [], packageManagers: [], warnings: [] },
  files: [{ path: "a.js", content: "never persist raw code" }],
  treeEntryCount: 1, downloadedBytes: 5, selectedBytes: 5, skipped: []
}

function fixture(options = {}) {
  const document = {
    _id: id, status: "queued", mode: "entire-project", processingAttempts: 0,
    updatedAt: new Date(Date.now() - 60000), ...options.document
  }
  const model = {
    findOneAndUpdate(filter, update) {
      if (!matches(document, filter)) return query(null)
      Object.assign(document, update.$set)
      document.processingAttempts += update.$inc.processingAttempts
      return query({ ...document })
    },
    findById() { return query({ ...document }) },
    find(filter) { return query(matches(document, filter) ? [{ ...document }] : []) },
    async updateOne(filter, update) {
      if (!matches(document, filter)) return { matchedCount: 0 }
      Object.assign(document, update.$set)
      return { matchedCount: 1 }
    }
  }
  let processor
  let disconnected = false
  class Worker {
    constructor(name, callback) { processor = callback }
    on() {}
    async close() {}
  }
  const { UnrecoverableError } = require("bullmq")
  const service = load("../src/workers/review.worker.js", {
    bullmq: { Worker, UnrecoverableError },
    "../models/review.model": model,
    "../config/redis": { createRedisConnection: () => ({ disconnect() { disconnected = true } }) },
    "../services/repository.service": {
      getReviewSource: options.retrieve || (async (review, signal, onStage) => {
        await onStage("fetching-files")
        await onStage("inspecting-repository")
        return source
      })
    }
  })
  const stop = service.startReviewWorker()
  return {
    document, model, stop,
    disconnected: () => disconnected,
    run: (overrides = {}) => processor({
      id: `review-${id}`, name: "scan-project", data: { reviewId: id },
      attemptsMade: 0, opts: { attempts: 3 }, ...overrides
    })
  }
}

test("worker saves partial preparation without source and ignores terminal redelivery", async () => {
  const f = fixture()
  await f.run()
  assert.equal(f.document.status, "partial")
  assert.equal(f.document.stage, "repository-ready")
  assert.equal(f.document.coverage.retainedFileCount, 1)
  assert.equal(f.document.processingToken, null)
  assert.equal(JSON.stringify(f.document).includes("never persist raw code"), false)
  await f.run()
  assert.equal(f.document.processingAttempts, 1)
  await f.stop()
  assert.equal(f.disconnected(), true)
})

test("worker rejects a duplicate claim while another processor is active", async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture({ retrieve: async () => { await gate; return source } })
  const first = f.run()
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.run(), /claim/)
  release()
  await first
  assert.equal(f.document.processingAttempts, 1)
  await f.stop()
})

for (const [label, error, attempts, expected] of [
  ["temporary failure retries", new Error("private credential"), 0, "queued"],
  ["last attempt fails", new Error("private credential"), 2, "failed"],
  ["revoked authorization fails", Object.assign(new Error("private credential"), { status: 401 }), 0, "failed"]
]) {
  test(label, async () => {
    const f = fixture({ retrieve: async () => { throw error } })
    await assert.rejects(f.run({ attemptsMade: attempts }), failure => !failure.message.includes("private credential"))
    assert.equal(f.document.status, expected)
    assert.equal(JSON.stringify(f.document).includes("private credential"), false)
    await f.stop()
  })
}

test("expired processor cannot overwrite a replacement claim", async () => {
  const f = fixture({ retrieve: async () => {
    f.document.processingToken = "replacement"
    return source
  } })
  await assert.rejects(f.run())
  assert.equal(f.document.processingToken, "replacement")
  assert.equal(f.document.status, "running")
  await f.stop()
})

test("shutdown aborts processing and releases the claim for retry", async () => {
  const f = fixture({ retrieve: (review, signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true })
  }) })
  const run = f.run()
  const rejected = assert.rejects(run)
  await new Promise(resolve => setImmediate(resolve))
  await f.stop()
  await rejected
  assert.equal(f.document.status, "queued")
  assert.equal(f.document.processingToken, null)
})

for (const [state, status, expected] of [
  ["missing", "running", "failed"],
  ["failed", "queued", "failed"],
  ["completed", "queued", "failed"],
  ["active", "running", "running"]
]) {
  test(`recovery reconciles ${status} review with ${state} job`, async () => {
    const f = fixture({ document: { status, processingExpiresAt: new Date(0) } })
    const service = load("../src/services/review.service.js", {
      "../models/review.model": f.model,
      "../queues/review.queue": {
        withReviewQueue: callback => callback(),
        reviewQueue: { getJob: async () => state === "missing" ? null : { getState: async () => state } }
      }
    })
    await service.recoverPendingReviews()
    assert.equal(f.document.status, expected)
    await f.stop()
  })
}

test("schema validates persisted summary and rejects negative coverage", async () => {
  const review = new Review({
    owner: id, project: id, mode: "entire-project", commitSha: "a".repeat(40),
    repositoryAnalysis: source.inspection,
    coverage: { treeEntryCount: 1, retainedFileCount: 1, downloadedBytes: 5, selectedBytes: 5, skipped: [] }
  })
  await review.validate()
  review.coverage.downloadedBytes = -1
  await assert.rejects(review.validate())
})

test("review read is owner-scoped and returns 404 for another owner", async () => {
  let observed
  const controller = load("../src/controllers/review.controller.js", {
    "../models/review.model": { findOne(filter) { observed = filter; return query(null) } },
    "../services/review.service": { enqueueReview: async () => {} }
  })
  const response = {
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this }
  }
  await controller.getReview({ params: { reviewId: id }, user: { _id: "different-owner" } }, response, error => { throw error })
  assert.equal(observed.owner, "different-owner")
  assert.equal(response.code, 404)
  assert.equal(response.body.review, undefined)
})

test("create-review duplicate returns existing record without fetching GitHub", async () => {
  let externalCalls = 0
  const existing = { _id: id, status: "running" }
  const controller = load("../src/controllers/review.controller.js", {
    "../models/project.model": { findOne: async () => ({ _id: id }) },
    "../models/review.model": { findOne: () => query(existing) },
    "../services/github.service": { getLatestCommit: async () => { externalCalls++ } },
    "../services/review.service": { enqueueReview: async () => { externalCalls++ } }
  })
  const response = {
    status(code) { this.code = code; return this },
    json(body) { this.body = body; return this }
  }
  await controller.createReview({ body: { projectId: id, mode: "entire-project" }, user: { _id: id } }, response, error => { throw error })
  assert.equal(response.code, 200)
  assert.equal(response.body.review._id, id)
  assert.equal(externalCalls, 0)
})
