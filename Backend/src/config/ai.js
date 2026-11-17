const aiConfig = {
  model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  timeoutMs: 30000,
  maxOutputTokens: 1500,
  maxImprovementFiles: 3,
  maxImprovementCharacters: 12000
}

module.exports = {
  aiConfig
}
