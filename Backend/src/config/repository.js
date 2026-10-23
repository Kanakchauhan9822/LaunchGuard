const repositoryLimits = {
  maxTreeEntries: 10000,
  maxFiles: 500,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  downloadConcurrency: 2,
  downloadTimeoutMs: 120000,
  fileTimeoutMs: 15000
}

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "vendor",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "coverage"
])

const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar",
  ".pyc", ".wasm", ".sqlite", ".db"
])

module.exports = {
  repositoryLimits,
  ignoredDirectories,
  binaryExtensions
}
