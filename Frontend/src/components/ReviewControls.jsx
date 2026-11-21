import { useCallback, useEffect, useRef, useState } from "react"
import { createReview, getReview, listReviews } from "../services/reviews"
import { githubLoginUrl } from "../services/github"
import { openPage } from "../navigation"
import PanelDivider from "./PanelDivider"
import ReviewFindings from "./ReviewFindings"
import ReviewImprovements from "./ReviewImprovements"
import ReviewManualTests from "./ReviewManualTests"

const activeStatuses = new Set(["pending", "queued", "running"])

const statusesWithFindings = new Set(["partial", "completed", "failed"])

function newestReview(current, incoming) {
  if (current && new Date(current.updatedAt) > new Date(incoming.updatedAt)) {
    return current
  }

  return incoming
}

function ReportMetadata({ report }) {
  return (
    <>
      <p>Commit: <code>{report.commitSha}</code></p>
      {report.mode === "latest-changes" && (
        <>
          <p>Compared with: <code>{report.baseCommitSha}</code></p>
          {["completed", "partial"].includes(report.status) && (
            <>
              <p>{report.scanScope === "changed-and-related" ? "Changed files and directly related code" : "Entire-project scan"}</p>
              {report.fallbackReason && <p>{report.fallbackReason}</p>}
              <p>
                New: {report.findingCounts?.new || 0}{" · "}
                Existing: {report.findingCounts?.existing || 0}{" · "}
                Resolved: {report.findingCounts?.resolved || 0}
              </p>
            </>
          )}
        </>
      )}
      {report.resultMessage && <p>{report.resultMessage}</p>}
      {report.failure && <p>{report.failure.message}</p>}
      <p>Requested: {new Date(report.createdAt).toLocaleString()}</p>

      {report.status !== "completed" && report.scannerOutcomes?.some(outcome => outcome.status !== "completed") && (
        <p>Some checks could not finish or did not apply. These findings may not cover the whole project.</p>
      )}
    </>
  )
}

function ReviewControls({ projectId, page, disabled, onSuccess, initialReviewId = "" }) {
  const [suggestionsShare, setSuggestionsShare] = useState(50)
  const [expandedReviewId, setExpandedReviewId] = useState(null)
  const [reportId, setReportId] = useState(initialReviewId)
  const [reviews, setReviews] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pollError, setPollError] = useState("")
  const [reconnect, setReconnect] = useState(false)
  const [pollVersion, setPollVersion] = useState(0)
  const submitting = useRef(false)
  const reading = useRef(false)
  const lifetime = useRef(null)

  const loadHistory = useCallback(async (cursor = null) => {
    const signal = lifetime.current?.signal

    if (!signal || signal.aborted || reading.current) {
      return
    }

    reading.current = true
    setLoading(true)
    setError("")

    try {
      const data = await listReviews(projectId, cursor, signal)
      if (!cursor && initialReviewId && !data.reviews.some(review => review._id === initialReviewId)) {
        const { review } = await getReview(initialReviewId, signal)
        if (review.project === projectId) data.reviews.push(review)
      }

      if (signal.aborted) {
        return
      }

      setReviews(current => {
        if (!cursor) {
          return data.reviews.map(review => newestReview(
            current.find(item => item._id === review._id),
            review
          ))
        }

        const ids = new Set(current.map(review => review._id))
        return [...current, ...data.reviews.filter(review => !ids.has(review._id))]
      })
      setNextCursor(data.nextCursor)

      if (!cursor) {
        setReady(true)
        setPollError("")
        setPollVersion(current => current + 1)
      }
    } catch (failure) {
      if (!signal.aborted) {
        setError(failure.message)

        if (!cursor) {
          setReady(false)
        }

        if (failure.status === 401 || failure.code === "GITHUB_RECONNECT") {
          setReconnect(true)
        }
      }
    } finally {
      if (!signal.aborted) {
        reading.current = false
        setLoading(false)
      }
    }
  }, [projectId, initialReviewId])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    reading.current = false
    void loadHistory()

    return () => controller.abort()
  }, [loadHistory])

  const activeReview = reviews.find(review => activeStatuses.has(review.status))
  const activeId = activeReview?._id

  useEffect(() => {
    if (!activeId || reconnect) {
      return
    }

    const controller = new AbortController()
    let timer

    async function poll() {
      let continuePolling = true

      try {
        const data = await getReview(activeId, controller.signal)

        if (controller.signal.aborted) {
          return
        }

        setPollError("")
        setReviews(current => current.map(review => {
          if (review._id === data.review._id) {
            return newestReview(review, data.review)
          }

          return review
        }))
        continuePolling = activeStatuses.has(data.review.status)
      } catch (failure) {
        if (controller.signal.aborted) {
          return
        }

        setPollError(failure.message)

        if (failure.status === 401 || failure.status === 403 || failure.status === 404) {
          continuePolling = false
          setReady(false)
        }

        if (failure.status === 401 || failure.code === "GITHUB_RECONNECT") {
          setReconnect(true)
          continuePolling = false
        }
      } finally {
        if (!controller.signal.aborted && continuePolling) {
          timer = setTimeout(poll, 10000)
        }
      }
    }

    timer = setTimeout(poll, 10000)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [activeId, reconnect, pollVersion])

  async function requestReview(mode = "entire-project") {
    if (submitting.current || reading.current || disabled || !ready || activeReview || reconnect) {
      return
    }

    const signal = lifetime.current.signal
    submitting.current = true
    setSaving(true)
    setReady(false)
    setMessage("")
    setError("")

    try {
      const data = await createReview(projectId, signal, mode)

      if (signal.aborted) {
        return
      }

      onSuccess(data.message)

      if (data.review) {
        setReportId(data.review._id)
        setReviews(current => [data.review, ...current.filter(review => review._id !== data.review._id)])
      }
    } catch (failure) {
      if (signal.aborted) {
        return
      }

      if (failure.status === 409) {
        setMessage(failure.message)
      } else {
        setMessage(`${failure.message}. Refresh review history before trying again; your request may have been saved.`)
      }

      if (failure.status === 401 || failure.code === "GITHUB_RECONNECT") {
        setReconnect(true)
      }
    } finally {
      if (!signal.aborted) {
        await loadHistory()

        if (!signal.aborted) {
          submitting.current = false
          setSaving(false)
        }
      }
    }
  }

  const report = reviews.find(review => review._id === reportId) || reviews[0]

  const hasFindings = statusesWithFindings.has(report?.status)
  const hasGuidance = ["partial", "completed"].includes(report?.status)

  const combined = page === "dashboard"
  const history = page === "history"

  return (
    <section aria-label="Project reviews">
      {combined && <div className="actions">
      <button
        type="button"
        onClick={() => requestReview()}
        disabled={disabled || loading || saving || !ready || Boolean(activeReview) || reconnect}
      >
        {saving ? "Submitting review..." : "Review Entire Project"}
      </button>
      <button
        type="button"
        onClick={() => requestReview("latest-changes")}
        disabled={disabled || loading || saving || !ready || Boolean(activeReview) || reconnect}
      >
        Review Latest Changes
      </button>
      <button
        type="button"
        onClick={() => loadHistory()}
        disabled={disabled || loading || saving}
      >
        Refresh reviews
      </button>
      </div>}
      {loading && <p role="status">Loading review history...</p>}
      {message && <p role="status">{message}</p>}
      {activeReview && <p role="status">Current review: {activeReview.status}</p>}
      {error && <p role="alert">{error}</p>}
      {pollError && <p role="alert">Could not update progress: {pollError}</p>}
      {reconnect && <p><a href={githubLoginUrl}>Reconnect GitHub</a></p>}
      {!loading && ready && reviews.length === 0 && <p>No reviews requested yet.</p>}
      {report && (
        <article className="report">
          {combined && (
            <div className="report-summary">
              <p>
                {report.mode === "entire-project" ? "Entire project" : "Latest changes"}
                {" — "}{report.status}
              </p>

              {report.branch && <p>Branch <code>{report.branch}</code></p>}
              <p>Commit <code title={report.commitSha}>{report.commitSha?.slice(0, 8)}</code></p>
            </div>
          )}
          {combined && <details className="report-meta"><summary>Review details</summary>
            <ReportMetadata report={report} />

          </details>}
          {history && <ul className="history-list">
            {reviews.map(item => (
              <li key={item._id}>
                <details
                  name="past-reviews"
                  className="report-meta"
                  onToggle={event => {
                    if (event.target !== event.currentTarget) return
                    const open = event.currentTarget.open
                    setExpandedReviewId(current => open ? item._id : current === item._id ? null : current)
                  }}
                >
                  <summary>{new Date(item.createdAt).toLocaleString()} · {item.mode === "entire-project" ? "Entire project" : "Latest changes"} · {item.status}</summary>
                  <ReportMetadata report={item} />
                  {expandedReviewId === item._id && statusesWithFindings.has(item.status) && (
                    <div className="report-grid">
                      <ReviewFindings reviewId={item._id} compared={item.mode === "latest-changes"} />
                    </div>
                  )}
                  <a href="/" onClick={event => openPage(projectId, "dashboard", item._id, event)}>Open report →</a>
                </details>
              </li>
            ))}
          </ul>}
          <div
            className={combined ? "report-grid report-split" : "report-grid report-single"}
            style={combined ? { "--list-track": suggestionsShare + "fr", "--detail-track": (100 - suggestionsShare) + "fr" } : undefined}
          >
            {hasFindings && (combined || page === "findings" || page === "solutions") && (
              <ReviewFindings solutions={page === "solutions"} key={report._id} reviewId={report._id} compared={report.mode === "latest-changes"} />
            )}
            {hasGuidance && (combined || page === "coding") && (
              <ReviewImprovements
                key={`${report._id}-${report.improvementStatus || "new"}`}
                review={report}
                disabled={disabled || reconnect}
              />
            )}
            {combined && hasGuidance && (
              <PanelDivider label="Resize coding suggestions" controls="suggestions" share={suggestionsShare} onResize={setSuggestionsShare} />
            )}
            {hasGuidance && (combined || page === "checks") && (
              <ReviewManualTests
                key={`manual-tests-${report._id}`}
                reviewId={report._id}
                disabled={disabled || reconnect}
              />
            )}
            {!combined && !history && !(page === "findings" || page === "solutions" ? hasFindings : hasGuidance) && (
              <p>This feature is unavailable for this {report.status} review.</p>
            )}
          </div>
        </article>
      )}
      {history && nextCursor && (
        <button
          type="button"
          onClick={() => loadHistory(nextCursor)}
          disabled={disabled || loading || saving}
        >
          Load older reviews
        </button>
      )}
    </section>
  )
}

export default ReviewControls
