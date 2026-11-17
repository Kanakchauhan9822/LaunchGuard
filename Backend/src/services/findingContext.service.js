const { prepareReviewRepository } = require("./repository.service")
const { createRepositoryBlobReader } = require("./github.service")
const { downloadRepositoryFiles } = require("./repositoryDownload.service")
const { scanWithGitleaks } = require("./gitleaks.service")

async function getFindingContext(review, finding, signal) {
  if (
    finding.category === "secret" ||
    !/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(finding.filePath || "") ||
    !Number.isSafeInteger(finding.startLine) ||
    finding.startLine < 1
  ) {
    return null
  }

  const contextSignal = AbortSignal.any([
    AbortSignal.timeout(20000),
    ...(signal ? [signal] : [])
  ])

  const prepared = await prepareReviewRepository(review, contextSignal)
  const file = prepared.selection.files.find(file => {
    return file.path === finding.filePath
  })

  if (!file) {
    return null
  }

  const readBlob = await createRepositoryBlobReader(
    prepared.userId,
    prepared.sessionId,
    prepared.repository
  )

  const source = await downloadRepositoryFiles(
    {
      files: [file],
      skipped: [],
      totalBytes: file.size
    },
    readBlob,
    contextSignal
  )

  const downloadedFile = source.files[0]

  if (!downloadedFile) {
    return null
  }

  const lines = downloadedFile.content.split(/\r?\n/)
  const start = Math.max(0, finding.startLine - 11)
  const end = Math.min(lines.length, finding.startLine + 10)
  const code = lines.slice(start, end).join("\n")

  if (!code || code.length > 6000) {
    return null
  }

  const secretScan = await scanWithGitleaks(
    [downloadedFile],
    contextSignal
  )

  if (
    secretScan.outcome.status !== "completed" ||
    secretScan.findings.length > 0
  ) {
    return null
  }

  return {
    commitSha: prepared.commitSha,
    filePath: file.path,
    startLine: start + 1,
    endLine: end,
    code
  }
}

module.exports = {
  getFindingContext
}
