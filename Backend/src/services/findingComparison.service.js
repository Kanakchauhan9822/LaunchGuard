const Finding = require("../models/finding.model")
const Review = require("../models/review.model")
const { githubError } = require("./github.service")
const { reviewProcessing } = require("../config/review")

async function compareFindings(review, findings, outcomes, source, signal) {
  const baseline = await Review.findOne({
    _id: review.baseReview,
    owner: review.owner,
    project: review.project,
    branch: review.branch,
    commitSha: review.baseCommitSha,
    status: "completed"
  }).select("commitSha").lean()

  if (!baseline) {
    throw githubError(409, "The completed baseline is unavailable. Run an entire-project review")
  }

  const previous = await Finding.find({
    review: baseline._id,
    changeStatus: { $ne: "resolved" }
  }).select("tool ruleId severity category title message dependency filePath startLine endLine fingerprint observedCommitSha")
    .limit(10001)
    .lean()

  if (previous.length > 10000) {
    throw githubError(422, "The saved report is too large. Run an entire-project review")
  }

  const renamed = new Map((source.changedFiles || [])
    .filter(file => file.status === "renamed" && file.previousPath)
    .map(file => [file.previousPath, file.path]))
  const successful = new Set(outcomes.filter(outcome => outcome.status === "completed").map(outcome => outcome.tool))
  const scanned = new Set(source.files.map(file => file.path))
  const buckets = new Map()
  const fingerprints = new Map(previous.map(finding => [`${finding.tool}:${finding.fingerprint}`, finding]))

  function identity(finding, filePath) {
    return JSON.stringify([
      finding.tool, finding.ruleId, filePath,
      finding.startLine, finding.endLine, finding.message
    ])
  }

  for (const finding of previous) {
    signal?.throwIfAborted()
    const key = identity(finding, renamed.get(finding.filePath) || finding.filePath)
    const bucket = buckets.get(key) || []
    bucket.push(finding)
    buckets.set(key, bucket)
  }

  const matched = new Set()
  const merged = findings.map(finding => {
    let previousFinding = fingerprints.get(`${finding.tool}:${finding.fingerprint}`)

    if (!previousFinding || matched.has(String(previousFinding._id))) {
      const bucket = buckets.get(identity(finding, finding.filePath)) || []

      do {
        previousFinding = bucket.shift()
      } while (previousFinding && matched.has(String(previousFinding._id)))
    }

    if (previousFinding) {
      matched.add(String(previousFinding._id))
    }

    return {
      ...finding,
      changeStatus: previousFinding ? "existing" : "new",
      observedCommitSha: review.commitSha,
      rechecked: true
    }
  })

  for (const finding of previous) {
    signal?.throwIfAborted()

    if (matched.has(String(finding._id))) {
      continue
    }

    const removed = finding.filePath && !source.allPaths.has(finding.filePath) && !renamed.has(finding.filePath)
    const rechecked = scanned.has(renamed.get(finding.filePath) || finding.filePath) && successful.has(finding.tool)
    const { _id, ...saved } = finding

    merged.push({
      ...saved,
      changeStatus: removed || rechecked ? "resolved" : "existing",
      observedCommitSha: finding.observedCommitSha || baseline.commitSha,
      rechecked: Boolean(removed || rechecked)
    })
  }

  if (Buffer.byteLength(JSON.stringify(merged), "utf8") > reviewProcessing.maxSummaryBytes) {
    throw githubError(422, "The combined report is too large. Run an entire-project review")
  }

  return merged
}

module.exports = {
  compareFindings
}
