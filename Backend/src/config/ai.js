const aiConfig = {
  model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  timeoutMs: 30000,
  maxOutputTokens: 1500,
  maxImprovementFiles: 3,
  maxImprovementCharacters: 12000,
  improvementOutputTokens: 4096,
  improvementTimeoutMs: 60000,
  improvementBatchDelayMs: 65000,
  improvementCacheTtlSeconds: 3600,
  maxImprovementCacheBytes: 8 * 1024 * 1024,
  improvementVersion: 3,
  maxImprovements: 500,
  manualTestVersion: 2,
  maxManualTests: 500
}

const testGenerationConfig = {
  model: aiConfig.model,
  timeoutMs: 60000,
  maxOutputTokens: 4096
}

module.exports = {
  aiConfig,
  testGenerationConfig
}
