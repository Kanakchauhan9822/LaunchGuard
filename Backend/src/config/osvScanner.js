const osvScannerConfig = {
  executable: process.env.OSV_SCANNER_PATH || (
    process.platform === "win32"
      ? "C:\\Tools\\osv-scanner\\osv-scanner.exe"
      : "osv-scanner"
  ),
  timeoutMs: 60000,
  maxOutputBytes: 4 * 1024 * 1024,
  maxFindings: 1000
}

const lockfileEcosystems = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["yarn.lock", "npm"],
  ["pnpm-lock.yaml", "npm"]
])

module.exports = {
  osvScannerConfig,
  lockfileEcosystems
}
