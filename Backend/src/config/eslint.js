const path = require("node:path")

const eslintConfig = {
  executable: process.execPath,
  cliPath: path.join(
    path.dirname(require.resolve("eslint/package.json")),
    "bin/eslint.js"
  ),
  rulesPath: path.join(__dirname, "eslint.config.cjs"),
  timeoutMs: 60000,
  maxOutputBytes: 4 * 1024 * 1024,
  maxFindings: 1000
}

module.exports = {
  eslintConfig
}
