import { useCallback, useEffect, useRef, useState } from "react"
import { listFindings } from "../services/reviews"
import FindingCard from "./FindingCard"

function ReviewFindings({ reviewId, compared }) {
  const [findings, setFindings] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [changeStatus, setChangeStatus] = useState("active")
  const request = useRef(null)

  const loadFindings = useCallback((cursor = null) => {
    if (request.current) {
      return
    }

    const controller = new AbortController()
    request.current = controller

    return listFindings(reviewId, cursor, controller.signal, changeStatus).then(data => {
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
  }, [reviewId, changeStatus])

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
      {compared && (
        <>
          <label>
            Show findings{" "}
            <select value={changeStatus} onChange={event => {
              setChangeStatus(event.target.value)
              setFindings([])
              setNextCursor(null)
              setLoaded(false)
              setLoading(true)
              setError("")
            }}>
              <option value="active">Active</option>
              <option value="new">New</option>
              <option value="existing">Existing</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </label>
          <p>Existing findings may be carried from earlier scans. Resolved means no longer reported after rechecking, or the file was removed.</p>
        </>
      )}
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
      {loaded && findings.length === 0 && <p>No findings match this view.</p>}
      {loaded && findings.length > 0 && (
        <p>Matching findings are grouped, with the highest severity first: critical, high, medium, low, info. Severity is the scanner's priority, not proof of an exploitable vulnerability.</p>
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
          Load more finding groups
        </button>
      )}
    </section>
  )
}

export default ReviewFindings
