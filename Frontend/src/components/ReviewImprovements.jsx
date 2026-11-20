import { useEffect, useRef, useState } from "react"
import { getImprovements, requestImprovements } from "../services/reviews"

const activeStatuses = new Set(["pending", "queued", "running"])

function ReviewImprovements({ review, disabled }) {
  const [result, setResult] = useState(review)
  const [submitting, setSubmitting] = useState(false)
  const [requestedHere, setRequestedHere] = useState(false)
  const [error, setError] = useState("")
  const [pollVersion, setPollVersion] = useState(0)
  const request = useRef(null)
  const active = activeStatuses.has(result.improvementStatus)
  const wholeCodeReview = result.improvementVersion >= 3
  const completed = result.improvementStatus === "completed" && wholeCodeReview
  const legacy = result.improvementStatus === "completed" && !wholeCodeReview
  const coverage = result.improvementCoverage

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
        setRequestedHere(true)
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
    <section id="suggestions" aria-label="Coding suggestions">
      <h3>Coding suggestions</h3>
      {!completed && !active && (
        <button type="button" onClick={suggestImprovements} disabled={disabled || submitting}>
          {legacy ? "Review whole codebase" : coverage?.completedParts > 0 ? "Continue coding review" : "Suggest improvements"}
        </button>
      )}
      {(submitting || active) && !error && (
        <div role="status" aria-label="Preparing coding suggestions">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      )}
      {wholeCodeReview && coverage && (coverage.eligibleFiles > 0 || completed) && (
        <>
          <p>{coverage.eligibleFiles > 0 && <progress aria-label="Coding suggestion coverage" value={coverage.reviewedFiles} max={coverage.eligibleFiles} />}{completed ? "Your coding review is complete." : `Reviewed ${coverage.reviewedFiles} of ${coverage.eligibleFiles} eligible files.`}</p>
          {active && <p>Completed {coverage.completedParts} of {coverage.totalParts} code sections. Batches are paced to reduce API limits.</p>}
          {coverage.excluded?.length > 0 && (
            <details>
              <summary>Files not reviewed ({coverage.excluded.length})</summary>
              <ul>
                {coverage.excluded.map(file => (
                  <li key={file.path}><code>{file.path}</code> — {file.reason.replaceAll("-", " ")}</li>
                ))}
              </ul>
            </details>
          )}
        </>
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
      {result.improvementStatus === "failed" && !error && (requestedHere || !result.improvementMessage?.includes("AI usage limit")) && (
        <p role="alert">{result.improvementMessage || "Suggestions could not finish. Please try again."}</p>
      )}
      {(completed || legacy || result.improvements?.length > 0) && (
        <>
          {legacy && (
            <p>These saved suggestions use earlier review rules. Choose Review whole codebase to apply the current file exclusions.</p>
          )}
          {result.improvementMessage && result.improvementStatus !== "failed" && <p>{result.improvementMessage}</p>}
          {completed && !result.improvementMessage && result.improvements.length === 0 && (
            <p>No useful improvements were suggested for the code covered by this review.</p>
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
