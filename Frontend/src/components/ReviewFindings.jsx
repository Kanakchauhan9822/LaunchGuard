import { useCallback, useEffect, useRef, useState } from "react"
import { listFindings } from "../services/reviews"
import FindingCard from "./FindingCard"

function ReviewFindings({ reviewId }) {
  const [findings, setFindings] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const request = useRef(null)

  const loadFindings = useCallback((cursor = null) => {
    if (request.current) {
      return
    }

    const controller = new AbortController()
    request.current = controller

    return listFindings(reviewId, cursor, controller.signal).then(data => {
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
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setError(failure.message)
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        request.current = null
        setLoading(false)
      }
    })
  }, [reviewId])

  useEffect(() => {
    void loadFindings()

    return () => {
      request.current?.abort()
      request.current = null
    }
  }, [loadFindings])

  function requestFindings(cursor = null) {
    if (request.current) {
      return
    }

    setLoading(true)
    setError("")
    void loadFindings(cursor)
  }

  return (
    <section aria-label="Review findings">
      {!loaded && !loading && (
        <button
          type="button"
          onClick={() => requestFindings()}
          disabled={loading}
        >
          Retry loading findings
        </button>
      )}

      {loading && <p role="status">Loading findings...</p>}
      {error && <p role="alert">{error}</p>}
      {loaded && findings.length === 0 && <p>No saved findings for this review.</p>}
      {loaded && findings.length > 0 && (
        <p>Highest severity first: critical, high, medium, low, info. Severity is the scanner's priority, not proof of an exploitable vulnerability.</p>
      )}

      <ul>
        {findings.map(finding => (
          <FindingCard key={finding._id} reviewId={reviewId} finding={finding} />
        ))}
      </ul>

      {nextCursor && (
        <button
          type="button"
          onClick={() => requestFindings(nextCursor)}
          disabled={loading}
        >
          Load more findings
        </button>
      )}
    </section>
  )
}

export default ReviewFindings
