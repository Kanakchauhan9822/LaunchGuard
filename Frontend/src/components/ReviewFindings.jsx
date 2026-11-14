import { useEffect, useRef, useState } from "react"
import { listFindings } from "../services/reviews"

function ReviewFindings({ reviewId }) {
  const [findings, setFindings] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const request = useRef(null)

  useEffect(() => {
    return () => request.current?.abort()
  }, [])

  async function loadFindings(cursor = null) {
    if (request.current) {
      return
    }

    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError("")

    try {
      const data = await listFindings(reviewId, cursor, controller.signal)

      if (controller.signal.aborted) {
        return
      }

      setFindings(current => {
        if (!cursor) {
          return data.findings
        }

        const ids = new Set(current.map(finding => finding._id))

        return [
          ...current,
          ...data.findings.filter(finding => !ids.has(finding._id))
        ]
      })
      setNextCursor(data.nextCursor)
      setLoaded(true)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure.message)
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setLoading(false)
      }
    }
  }

  return (
    <section aria-label="Review findings">
      {!loaded && (
        <button
          type="button"
          onClick={() => loadFindings()}
          disabled={loading}
        >
          Show findings
        </button>
      )}

      {loading && <p role="status">Loading findings...</p>}
      {error && <p role="alert">{error}</p>}
      {loaded && findings.length === 0 && <p>No saved findings for this review.</p>}

      <ul>
        {findings.map(finding => (
          <li key={finding._id}>
            <h4>{finding.title}</h4>
            <p>{finding.tool} · {finding.severity} · {finding.category}</p>
            <p>Rule: <code>{finding.ruleId}</code></p>
            {finding.filePath && (
              <p>
                <code>{finding.filePath}</code>
                {finding.startLine && ` — line ${finding.startLine}`}
              </p>
            )}
            <p>{finding.message}</p>
          </li>
        ))}
      </ul>

      {nextCursor && (
        <button
          type="button"
          onClick={() => loadFindings(nextCursor)}
          disabled={loading}
        >
          Load more findings
        </button>
      )}
    </section>
  )
}

export default ReviewFindings
