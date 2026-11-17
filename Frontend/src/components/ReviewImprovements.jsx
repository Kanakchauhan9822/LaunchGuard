import { useEffect, useRef, useState } from "react"
import { getImprovements, requestImprovements } from "../services/reviews"

const activeStatuses = new Set(["pending", "queued", "running"])

function ReviewImprovements({ review, disabled }) {
  const [result, setResult] = useState(review)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [pollVersion, setPollVersion] = useState(0)
  const request = useRef(null)
  const active = activeStatuses.has(result.improvementStatus)
  const completed = result.improvementStatus === "completed"

  useEffect(() => {
    return () => request.current?.abort()
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }

    const controller = new AbortController()
    let timer

    async function poll() {
      try {
        const data = await getImprovements(review._id, controller.signal)

        if (controller.signal.aborted) {
          return
        }

        setResult(data.review)
        setError("")

        if (activeStatuses.has(data.review.improvementStatus)) {
          timer = setTimeout(poll, 3000)
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure.message)
        }
      }
    }

    timer = setTimeout(poll, 1000)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [active, review._id, pollVersion])

  async function suggestImprovements() {
    if (request.current || disabled || active || completed) {
      return
    }

    const controller = new AbortController()
    request.current = controller
    setSubmitting(true)
    setError("")

    try {
      const data = await requestImprovements(review._id, controller.signal)

      if (!controller.signal.aborted) {
        setResult(data.review)
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure.message)
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setSubmitting(false)
      }
    }
  }

  return (
    <section aria-label="Coding suggestions">
      <h4>Coding suggestions</h4>
      {!completed && !active && (
        <button type="button" onClick={suggestImprovements} disabled={disabled || submitting}>
          {result.improvementStatus === "failed" || error ? "Try suggestions again" : "Suggest improvements"}
        </button>
      )}
      {(submitting || active) && !error && (
        <div role="status" aria-label="Preparing coding suggestions">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {error && active && (
        <button type="button" onClick={() => {
          setError("")
          setPollVersion(current => current + 1)
        }}>
          Check again
        </button>
      )}
      {result.improvementStatus === "failed" && !error && (
        <p role="alert">{result.improvementMessage || "Suggestions could not finish. Please try again."}</p>
      )}
      {completed && (
        <>
          {result.improvementFiles?.length > 0 && (
            <p>Focused review of: {result.improvementFiles.join(", ")}. Other files were not reviewed.</p>
          )}
          {result.improvementMessage && <p>{result.improvementMessage}</p>}
          {!result.improvementMessage && result.improvements.length === 0 && (
            <p>No useful improvements were suggested for the reviewed files.</p>
          )}
          <ul>
            {result.improvements.map((improvement, index) => (
              <li key={`${improvement.filePath}-${improvement.startLine}-${index}`}>
                <details>
                  <summary>{improvement.title}</summary>
                  <p><code>{improvement.filePath}</code> — line {improvement.startLine}</p>
                  <p>{improvement.observation}</p>
                  <p><strong>Try:</strong> {improvement.suggestion}</p>
                  <p><strong>Benefit:</strong> {improvement.benefit}</p>
                  <p><strong>Consider:</strong> {improvement.tradeoff}</p>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export default ReviewImprovements
