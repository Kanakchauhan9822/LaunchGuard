const { aiConfig } = require("../config/ai")
const { scanWithGitleaks } = require("./gitleaks.service")

async function generateAiResponse(messages, signal, responseFormat) {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    throw new Error("AI service is not configured")
  }

  try {
    const safetySignal = AbortSignal.any([
      AbortSignal.timeout(5000),
      ...(signal ? [signal] : [])
    ])
    const inputScan = await scanWithGitleaks([
      {
        path: "context.json",
        mode: "100644",
        content: JSON.stringify(messages)
      }
    ], safetySignal)

    if (inputScan.outcome.status !== "completed" || inputScan.findings.length > 0) {
      throw new Error("AI input did not pass the secret check")
    }

    const timeoutSignal = AbortSignal.timeout(aiConfig.timeoutMs)
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages,
          response_format: responseFormat,
          max_completion_tokens: aiConfig.maxOutputTokens
        }),
        signal: signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal
      }
    )

    if (!response.ok) {
      throw new Error("AI request failed")
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    const content = choice?.message?.content

    if (
      choice?.finish_reason !== "stop" ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      throw new Error("AI returned an incomplete or invalid response")
    }

    return content.trim()
  } catch {
    signal?.throwIfAborted()

    throw new Error("Could not generate the AI response. Please try again")
  }
}

module.exports = {
  generateAiResponse
}
