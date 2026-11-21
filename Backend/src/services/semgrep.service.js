const path = require("node:path")
const { createHash } = require("node:crypto")
const { semgrepConfig } = require("../config/semgrep")
const { withScanWorkspace } = require("./scanWorkspace.service")
const { runScanner, scanResult, scannerError } = require("./scanner.service")

async function scanWithSemgrep(files, signal) {
  signal?.throwIfAborted()
  const startedAt = new Date()

  try {
    if (!Array.isArray(files)) {
      throw scannerError("Invalid scan file list.")
    }

    const selectedFiles = files.filter(file =>
      /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file?.path)
    )

    if (selectedFiles.length === 0) {
      return scanResult(
        "semgrep",
        "skipped",
        [],
        "No supported JavaScript or TypeScript source files were available to scan.",
        null
      )
    }

    const findings = await withScanWorkspace(
      selectedFiles,
      async ({ workspace, sourceDirectory }) => {
        const report = await runSemgrep(workspace, sourceDirectory, signal)

        return convertFindings(report, sourceDirectory, selectedFiles)
      },
      signal
    )

    return scanResult("semgrep", "completed", findings, null, startedAt)
  } catch (error) {
    signal?.throwIfAborted()

    return scanResult(
      "semgrep",
      "failed",
      [],
      error.scannerFailure || "Could not prepare, scan or clean up the temporary scan workspace.",
      startedAt
    )
  }
}

async function runSemgrep(workspace, sourceDirectory, signal) {
  const args = [
    "scan",
    "--config", semgrepConfig.rulesPath,
    "--json",
    "--quiet",
    "--metrics=off",
    "--disable-version-check",
    "--disable-nosem",
    "--no-git-ignore",
    "--no-rewrite-rule-ids",
    "--strict",
    "--jobs", "1",
    "--timeout", process.env.RENDER === "true" ? "40" : "10",
    "--max-memory", process.env.RENDER === "true" ? "160" : "256",
    sourceDirectory
  ]

  const report = await runScanner(
    "Semgrep",
    semgrepConfig,
    args,
    workspace,
    signal
  )

  if (report.exitCode !== 0 || report.stderrBytes > 0) {
    throw scannerError(
      "Semgrep did not finish successfully. No clean-scan result was recorded."
    )
  }

  let data

  try {
    data = JSON.parse(report.output)
  } catch {
    throw scannerError("Semgrep returned an invalid JSON report.")
  }

  if (
    !Array.isArray(data?.results) ||
    !Array.isArray(data?.errors) ||
    data.errors.length > 0 ||
    !Array.isArray(data?.paths?.scanned) ||
    data.results.length > semgrepConfig.maxFindings
  ) {
    throw scannerError(
      "Semgrep returned scan errors, an invalid report or too many findings."
    )
  }

  if (data.paths.scanned.length === 0) {
    throw scannerError("Semgrep did not scan any supported source files.")
  }

  return data.results
}

function convertFindings(records, sourceDirectory, files) {
  const allowedPaths = new Set(files.map(file => file.path))
  const findings = new Map()
  const severities = {
    ERROR: "high",
    WARNING: "medium",
    INFO: "info"
  }

  for (const record of records) {
    const severity = severities[record?.extra?.severity]

    if (
      typeof record?.path !== "string" ||
      typeof record.check_id !== "string" ||
      !/^[a-zA-Z0-9._-]{1,500}$/.test(record.check_id) ||
      !severity ||
      !Number.isSafeInteger(record.start?.line) ||
      !Number.isSafeInteger(record.end?.line) ||
      record.start.line < 1 ||
      record.end.line < record.start.line
    ) {
      throw scannerError("Semgrep returned unsupported finding metadata.")
    }

    const absolutePath = path.resolve(sourceDirectory, "..", record.path)
    const filePath = path.relative(sourceDirectory, absolutePath)
      .split(path.sep)
      .join("/")

    if (!allowedPaths.has(filePath)) {
      throw scannerError(
        "Semgrep reported a file outside the selected scan files."
      )
    }

    const fingerprint = createHash("sha256")
      .update(JSON.stringify([
        "semgrep",
        record.check_id,
        filePath,
        record.start.line,
        record.end.line,
        record.start.col,
        record.end.col
      ]))
      .digest("hex")

    findings.set(fingerprint, {
      tool: "semgrep",
      ruleId: record.check_id,
      severity,
      category: "security",
      title: "Potential source-code security issue",
      message: `Semgrep matched rule ${record.check_id} at this location. Review the code and rule before treating this as a confirmed vulnerability. Severity reflects the rule's configured priority. Matched source code is not stored.`,
      filePath,
      startLine: record.start.line,
      endLine: record.end.line,
      fingerprint
    })
  }

  return [...findings.values()]
}

module.exports = {
  scanWithSemgrep
}
