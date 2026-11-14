const path = require("node:path")

const gitleaksConfig = {
  executable: process.env.GITLEAKS_PATH || (
    process.platform === "win32"
      ? "C:\\Tools\\gitleaks\\gitleaks.exe"
      : "gitleaks"
  ),
  rulesPath: path.join(__dirname, "gitleaks.toml"),
  timeoutMs: 60000,
  maxOutputBytes: 4 * 1024 * 1024,
  maxFindings: 1000,
  findingsExitCode: 2
}

module.exports = {
  gitleaksConfig
}
