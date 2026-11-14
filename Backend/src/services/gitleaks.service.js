const fs = require("node:fs/promises")
const path = require("node:path")
const { createHash } = require("node:crypto")
const { gitleaksConfig } = require("../config/gitleaks")
const { withScanWorkspace } = require("./scanWorkspace.service")
const { runScanner, scanResult, scannerError } = require("./scanner.service")

async function scanWithGitleaks(files, signal) {
  signal?.throwIfAborted()
  const startedAt = new Date()

  try {
    if (Array.isArray(files) && files.length === 0) {
      return scanResult(
        "gitleaks", "skipped", [],
        "No eligible downloaded text files were available to scan.", null
      )
    }

    const findings = await withScanWorkspace(files, async ({ workspace, sourceDirectory }) => {
      const ignorePath = path.join(workspace, "empty.gitleaksignore")
      await fs.writeFile(ignorePath, "", { flag: "wx", mode: 0o600 })
      const report = await runGitleaks(workspace, sourceDirectory, ignorePath, signal)
      return convertFindings(report, sourceDirectory, files)
    }, signal)

    return scanResult("gitleaks", "completed", findings, null, startedAt)
  } catch (error) {
    signal?.throwIfAborted()

    return scanResult(
      "gitleaks", "failed", [],
      error.scannerFailure || "Could not prepare, scan or clean up the temporary scan workspace.",
      startedAt
    )
  }
}

async function runGitleaks(workspace, sourceDirectory, ignorePath, signal) {
  signal?.throwIfAborted()
  const args = [
    "dir", sourceDirectory,
    "--config", gitleaksConfig.rulesPath,
    "--gitleaks-ignore-path", ignorePath,
    "--ignore-gitleaks-allow",
    "--redact=100",
    "--report-format", "json",
    "--report-path", "-",
    "--exit-code", String(gitleaksConfig.findingsExitCode),
    "--timeout", String(Math.ceil(gitleaksConfig.timeoutMs / 1000)),
    "--max-archive-depth", "0",
    "--max-decode-depth", "0",
    "--log-level", "error",
    "--no-banner",
    "--no-color"
  ]

  const report = await runScanner("Gitleaks", gitleaksConfig, args, workspace, signal)

  if (report.stderrBytes > 0 || ![0, gitleaksConfig.findingsExitCode].includes(report.exitCode)) {
    throw scannerError("Gitleaks did not finish successfully. No clean-scan result was recorded.")
  }

  try {
    const records = JSON.parse(report.output) ?? []

    if (
      !Array.isArray(records) ||
      records.length > gitleaksConfig.maxFindings ||
      (report.exitCode === 0 && records.length !== 0) ||
      (report.exitCode === gitleaksConfig.findingsExitCode && records.length === 0)
    ) {
      throw new Error()
    }

    return records
  } catch {
    throw scannerError("Gitleaks returned an invalid report or exceeded the finding limit.")
  }
}

function convertFindings(records, sourceDirectory, files) {
  const allowedPaths = new Set(files.map(file => file.path))
  const findings = new Map()

  for (const record of records) {
    if (
      !record ||
      typeof record.File !== "string" ||
      typeof record.RuleID !== "string" ||
      !/^[a-zA-Z0-9._-]{1,500}$/.test(record.RuleID) ||
      !Number.isSafeInteger(record.StartLine) ||
      !Number.isSafeInteger(record.EndLine) ||
      record.StartLine < 1 ||
      record.EndLine < record.StartLine
    ) {
      throw scannerError("Gitleaks returned unsupported finding metadata.")
    }

    const absolutePath = path.resolve(sourceDirectory, record.File)
    const filePath = path.relative(sourceDirectory, absolutePath).split(path.sep).join("/")

    if (!allowedPaths.has(filePath)) {
      throw scannerError("Gitleaks reported a file outside the selected scan files.")
    }

    const fingerprint = createHash("sha256")
      .update(JSON.stringify([
        "gitleaks", record.RuleID, filePath,
        record.StartLine, record.EndLine,
        Number.isSafeInteger(record.StartColumn) ? record.StartColumn : null,
        Number.isSafeInteger(record.EndColumn) ? record.EndColumn : null
      ]))
      .digest("hex")

    findings.set(fingerprint, {
      tool: "gitleaks",
      ruleId: record.RuleID,
      severity: "high",
      category: "secret",
      title: "Potential exposed secret",
      message: "Gitleaks matched a secret-detection rule at this location. Verify the finding and rotate any real exposed credential. The matched value is not stored.",
      filePath,
      startLine: record.StartLine,
      endLine: record.EndLine,
      fingerprint
    })
  }

  return [...findings.values()]
}

module.exports = {
  scanWithGitleaks
}
