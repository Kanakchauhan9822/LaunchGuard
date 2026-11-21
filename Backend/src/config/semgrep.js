const path = require("node:path")

const semgrepConfig = {
  executable: process.env.SEMGREP_PATH || (
    process.platform === "win32"
      ? "C:\\Users\\kanak\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\semgrep.exe"
      : "semgrep"
  ),
  rulesPath: process.env.SEMGREP_RULES_PATH || path.join(__dirname, "semgrep-rules"),
  timeoutMs: process.env.RENDER === "true" ? 150000 : 60000,
  maxOutputBytes: 4 * 1024 * 1024,
  maxFindings: 1000
}

module.exports = {
  semgrepConfig
}
