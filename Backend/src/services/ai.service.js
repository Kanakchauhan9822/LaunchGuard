const { aiConfig } = require("../config/ai")
const { scanWithGitleaks } = require("./gitleaks.service")

async function checkAiInput(messages, signal) {
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

  if (
    inputScan.outcome.status !== "completed" ||
    inputScan.findings.length > 0
  ) {
    throw new Error("AI input did not pass the secret check")
  }
}

async function generateAiResponse(messages, signal, responseFormat, config = aiConfig) {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    throw new Error("AI service is not configured")
  }

  try {
    await checkAiInput(messages, signal)

    const timeoutSignal = AbortSignal.timeout(config.timeoutMs)
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          response_format: responseFormat,
          max_completion_tokens: config.maxOutputTokens
        }),
        signal: signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal
      }
    )

    if (response.status === 503 || response.status === 429) {
      const highDemand = response.status === 503
      const message = highDemand
        ? "Cannot generate the result due to high demand."
        : "Cannot generate the result because the AI usage limit has been reached. Please try again later."

      throw Object.assign(new Error(message), {
        status: response.status,
        code: highDemand ? "AI_HIGH_DEMAND" : "AI_RATE_LIMIT",
        publicMessage: message
      })
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))

      if (data.error?.code === "json_validate_failed") {
        throw Object.assign(new Error("AI returned invalid structured output"), {
          status: 502,
          code: "AI_INVALID_RESPONSE",
          publicMessage: "The AI could not prepare a usable response. Please try again."
        })
      }

      throw new Error("AI request failed")
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    const content = choice?.message?.content

    if (choice?.finish_reason === "length") {
      throw Object.assign(new Error("AI response exceeded its output budget"), {
        status: 502,
        code: "AI_RESPONSE_TOO_LONG",
        publicMessage: "The AI response was cut short before it finished. Please try again."
      })
    }

    if (
      choice?.finish_reason !== "stop" ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      throw new Error("AI returned an incomplete or invalid response")
    }

    return content.trim()
  } catch (error) {
    signal?.throwIfAborted()

    if (["AI_HIGH_DEMAND", "AI_RATE_LIMIT", "AI_INVALID_RESPONSE", "AI_RESPONSE_TOO_LONG"].includes(error.code)) {
      throw error
    }

    throw new Error("Could not generate the AI response. Please try again")
  }
}

module.exports = {
  generateAiResponse,
  checkAiInput
}
