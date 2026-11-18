const path = require("node:path")
const fs = require("node:fs/promises")
const { createHash } = require("node:crypto")
const { osvScannerConfig, lockfileEcosystems } = require("../config/osvScanner")
const { withScanWorkspace } = require("./scanWorkspace.service")
const { runScanner, scanResult, scannerError } = require("./scanner.service")

async function scanWithOsv(files, signal) {
  signal?.throwIfAborted()
  const startedAt = new Date()

  try {
    const lockfiles = selectLockfiles(files)

    if (lockfiles.length === 0) {
      return scanResult(
        "osv-scanner",
        "skipped",
        [],
        "No supported dependency lockfiles were available to scan.",
        null
      )
    }

    const result = await withScanWorkspace(
      lockfiles,
      async ({ workspace, sourceDirectory }) => {
        const runnerDirectory = path.join(workspace, "runner")
        await fs.mkdir(runnerDirectory, { mode: 0o700 })

        const configPath = path.join(runnerDirectory, "osv-scanner.toml")
        await fs.writeFile(configPath, "", {
          flag: "wx",
          mode: 0o600
        })

        const report = await runOsv(
          sourceDirectory,
          configPath,
          lockfiles,
          signal
        )

        return parseReport(report, sourceDirectory, lockfiles)
      },
      signal
    )

    if (result.noPackages) {
      return scanResult(
        "osv-scanner",
        "skipped",
        [],
        "OSV-Scanner found no packages in the selected lockfiles.",
        startedAt
      )
    }

    return scanResult("osv-scanner", "completed", result.findings, null, startedAt)
  } catch (error) {
    signal?.throwIfAborted()

    return scanResult(
      "osv-scanner",
      "failed",
      [],
      error.scannerFailure || "Could not prepare, scan or clean up the dependency scan workspace.",
      startedAt
    )
  }
}

function selectLockfiles(files) {
  if (!Array.isArray(files)) {
    throw scannerError("Invalid dependency scan file list")
  }

  return files.filter(file => {
    if (!file || typeof file.path !== "string") {
      throw scannerError("Invalid dependency scan file entry")
    }

    return lockfileEcosystems.has(path.posix.basename(file.path))
  })
}

async function runOsv(sourceDirectory, configPath, lockfiles, signal) {
  signal?.throwIfAborted()

  const args = [
    "scan",
    "source",
    "--format",
    "json",
    "--config",
    configPath,
    "--no-resolve",
    "--no-call-analysis",
    "go,rust",
    "--all-packages",
    "--all-vulns",
    "--verbosity",
    "error"
  ]

  for (const file of lockfiles) {
    args.push("--lockfile", path.resolve(sourceDirectory, file.path))
  }

  const runnerDirectory = path.dirname(configPath)

  const report = await runScanner("OSV-Scanner", osvScannerConfig, args, runnerDirectory, signal)

  if (
    ![0, 1, 128].includes(report.exitCode) ||
    (report.stderrBytes > 0 && report.exitCode !== 128)
  ) {
    throw scannerError("OSV-Scanner did not finish successfully")
  }

  return report
}

function parseReport(report, sourceDirectory, lockfiles) {
  if (report.exitCode === 128 && !report.output.trim()) {
    return { findings: [], noPackages: true }
  }

  let data

  try {
    data = JSON.parse(report.output)
  } catch {
    throw scannerError("OSV-Scanner returned invalid JSON")
  }

  if (!Array.isArray(data?.results)) {
    throw scannerError("OSV-Scanner returned an unsupported report")
  }

  const allowedPaths = new Set(lockfiles.map(file => file.path))
  const findings = new Map()
  let packageCount = 0

  for (const result of data.results) {
    if (
      result?.source?.type !== "lockfile" ||
      typeof result.source.path !== "string" ||
      !Array.isArray(result.packages)
    ) {
      throw scannerError("OSV-Scanner returned invalid source metadata")
    }

    const absolutePath = path.resolve(sourceDirectory, result.source.path)
    const filePath = path.relative(sourceDirectory, absolutePath)
      .split(path.sep)
      .join("/")

    if (!allowedPaths.has(filePath)) {
      throw scannerError("OSV-Scanner reported an unexpected lockfile")
    }

    for (const entry of result.packages) {
      const packageFindings = convertPackage(entry, filePath, lockfileEcosystems.get(path.posix.basename(filePath)))
      packageCount++

      for (const finding of packageFindings) {
        findings.set(finding.fingerprint, finding)

        if (findings.size > osvScannerConfig.maxFindings) {
          throw scannerError("OSV-Scanner exceeded the finding limit")
        }
      }
    }
  }

  if (
    (report.exitCode === 0 && (packageCount === 0 || findings.size > 0)) ||
    (report.exitCode === 1 && findings.size === 0) ||
    (report.exitCode === 128 && packageCount > 0)
  ) {
    throw scannerError("OSV-Scanner exit code and report disagree")
  }

  return {
    findings: [...findings.values()],
    noPackages: report.exitCode === 128
  }
}

function convertPackage(entry, filePath, ecosystem) {
  const dependency = entry?.package
  const vulnerabilities = entry?.vulnerabilities ?? []
  const groups = entry?.groups ?? []

  if (
    dependency?.ecosystem !== ecosystem ||
    typeof dependency.name !== "string" ||
    !/^[a-zA-Z0-9@._/-]{1,214}$/.test(dependency.name) ||
    typeof dependency.version !== "string" ||
    !/^[a-zA-Z0-9.+_-]{1,256}$/.test(dependency.version) ||
    !Array.isArray(vulnerabilities) ||
    !Array.isArray(groups) ||
    vulnerabilities.some(item => !isAdvisoryId(item?.id))
  ) {
    throw scannerError("OSV-Scanner returned invalid package metadata")
  }

  const reportedIds = new Set(vulnerabilities.map(item => item.id))
  const groupedIds = new Set()
  const findings = []

  for (const group of groups) {
    if (
      !Array.isArray(group?.ids) ||
      group.ids.length === 0 ||
      group.ids.some(id => !isAdvisoryId(id) || !reportedIds.has(id))
    ) {
      throw scannerError("OSV-Scanner returned an invalid advisory group")
    }

    const ids = [...new Set(group.ids)].sort()

    for (const id of ids) {
      groupedIds.add(id)
    }

    const ruleId = ids[0]
    const severity = getSeverity(group.max_severity)
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([
        "osv-scanner",
        filePath,
        dependency.name,
        dependency.version,
        ruleId
      ]))
      .digest("hex")

    const fixedVersions = [...new Set(vulnerabilities
      .filter(vulnerability => ids.includes(vulnerability.id))
      .flatMap(vulnerability => vulnerability.affected || [])
      .filter(affected => affected.package?.name === dependency.name && affected.package.ecosystem === ecosystem)
      .flatMap(affected => affected.ranges || [])
      .filter(range => range.type === "SEMVER" || range.type === "ECOSYSTEM")
      .flatMap(range => range.events || [])
      .map(event => event.fixed)
      .filter(version => typeof version === "string" && /^[a-zA-Z0-9.+_-]{1,256}$/.test(version)))]
      .sort()
      .slice(0, 20)

    let message = `The installed package ${dependency.name}@${dependency.version} has a reported vulnerability (${ruleId}). `
    message += `See https://osv.dev/vulnerability/${ruleId}. `
    message += fixedVersions.length > 0
      ? "Fix versions are listed with this finding. Check compatibility and other advisories before upgrading. "
      : "No fix version was reported for this issue. Check the advisory for update guidance. "
    message += "Use the package manager to update the dependency and regenerate the lockfile; do not edit the lockfile manually. "
    message += "The affected dependency may not be reachable in this application."

    if (!severity) {
      message += " Severity was unavailable; info is a placeholder, not a low-risk assessment."
    }

    findings.push({
      tool: "osv-scanner",
      ruleId,
      severity: severity || "info",
      category: "dependency",
      title: `${dependency.name} has a known vulnerability`,
      dependency: { name: dependency.name, version: dependency.version, fixedVersions },
      message,
      filePath,
      startLine: null,
      endLine: null,
      fingerprint
    })
  }

  if ([...reportedIds].some(id => !groupedIds.has(id))) {
    throw scannerError("OSV-Scanner returned ungrouped vulnerabilities")
  }

  return findings
}

function getSeverity(value) {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) {
    return null
  }

  const score = Number(value)

  if (score > 10) {
    return null
  }

  if (score >= 9) {
    return "critical"
  }

  if (score >= 7) {
    return "high"
  }

  if (score >= 4) {
    return "medium"
  }

  return score > 0 ? "low" : "info"
}

function isAdvisoryId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value)
}

module.exports = {
  scanWithOsv
}
