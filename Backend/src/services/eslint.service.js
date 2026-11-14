const path = require("node:path")
const { createHash } = require("node:crypto")
const { eslintConfig } = require("../config/eslint")
const { withScanWorkspace } = require("./scanWorkspace.service")
const { runScanner, scanResult, scannerError } = require("./scanner.service")

async function scanWithEslint(files, signal) {
  signal?.throwIfAborted()
  const startedAt = new Date()

  try {
    if (!Array.isArray(files)) {
      throw scannerError("Invalid scan file list.")
    }

    const selectedFiles = files.filter(file =>
      /\.(js|jsx|mjs|cjs)$/.test(file?.path)
    )

    if (selectedFiles.length === 0) {
      return scanResult(
        "eslint",
        "skipped",
        [],
        "No supported JavaScript or JSX files were available to scan.",
        null
      )
    }

    const findings = await withScanWorkspace(
      selectedFiles,
      async ({ workspace, sourceDirectory }) => {
        const report = await runEslint(workspace, sourceDirectory, signal)

        return convertFindings(report, sourceDirectory, selectedFiles)
      },
      signal
    )

    return scanResult("eslint", "completed", findings, null, startedAt)
  } catch (error) {
    signal?.throwIfAborted()

    return scanResult(
      "eslint",
      "failed",
      [],
      error.scannerFailure || "Could not prepare, scan or clean up the temporary scan workspace.",
      startedAt
    )
  }
}

async function runEslint(workspace, sourceDirectory, signal) {
  const args = [
    eslintConfig.cliPath,
    "--no-config-lookup",
    "--config", eslintConfig.rulesPath,
    "--no-inline-config",
    "--no-ignore",
    "--format", "json",
    "--ext", ".js,.jsx,.mjs,.cjs",
    sourceDirectory
  ]

  const report = await runScanner(
    "ESLint",
    eslintConfig,
    args,
    workspace,
    signal
  )

  if (![0, 1].includes(report.exitCode) || report.stderrBytes > 0) {
    throw scannerError(
      "ESLint did not finish successfully. No clean-scan result was recorded."
    )
  }

  let records

  try {
    records = JSON.parse(report.output)
  } catch {
    throw scannerError("ESLint returned an invalid JSON report.")
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw scannerError("ESLint did not return results for supported source files.")
  }

  let findingCount = 0

  for (const record of records) {
    if (
      !Array.isArray(record?.messages) ||
      record.fatalErrorCount !== 0
    ) {
      throw scannerError("ESLint could not fully parse or check the selected files.")
    }

    findingCount += record.messages.length

    if (findingCount > eslintConfig.maxFindings) {
      throw scannerError("ESLint exceeded its finding limit.")
    }
  }

  return records
}

function convertFindings(records, sourceDirectory, files) {
  const allowedPaths = new Set(files.map(file => file.path))
  const findings = new Map()

  for (const record of records) {
    if (typeof record.filePath !== "string") {
      throw scannerError("ESLint returned an invalid file path.")
    }

    const filePath = path.relative(sourceDirectory, record.filePath)
      .split(path.sep)
      .join("/")

    if (!allowedPaths.has(filePath)) {
      throw scannerError(
        "ESLint reported a file outside the selected scan files."
      )
    }

    for (const message of record.messages) {
      const endLine = message.endLine ?? message.line

      if (
        typeof message.ruleId !== "string" ||
        !/^[a-zA-Z0-9@/._-]{1,500}$/.test(message.ruleId) ||
        ![1, 2].includes(message.severity) ||
        !Number.isSafeInteger(message.line) ||
        !Number.isSafeInteger(endLine) ||
        message.line < 1 ||
        endLine < message.line
      ) {
        throw scannerError("ESLint returned unsupported finding metadata.")
      }

      const fingerprint = createHash("sha256")
        .update(JSON.stringify([
          "eslint",
          message.ruleId,
          filePath,
          message.line,
          endLine,
          message.column ?? null,
          message.endColumn ?? null
        ]))
        .digest("hex")

      findings.set(fingerprint, {
        tool: "eslint",
        ruleId: message.ruleId,
        severity: message.severity === 2 ? "medium" : "low",
        category: "code-quality",
        title: "Potential JavaScript or JSX coding issue",
        message: `ESLint matched rule ${message.ruleId} at this location. Review the rule and surrounding code before applying a change. Severity reflects lint priority, not security impact. Matched source code is not stored.`,
        filePath,
        startLine: message.line,
        endLine,
        fingerprint
      })
    }
  }

  return [...findings.values()]
}

module.exports = {
  scanWithEslint
}
