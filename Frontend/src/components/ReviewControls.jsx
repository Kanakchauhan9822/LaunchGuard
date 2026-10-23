import { useCallback, useEffect, useRef, useState } from "react"
import { createReview, getReview, listReviews } from "../services/reviews"
import { githubLoginUrl } from "../services/github"

const activeStatuses = new Set(["pending", "queued", "running"])

function newestReview(current, incoming) {
  if (current && new Date(current.updatedAt) > new Date(incoming.updatedAt)) {
    return current
  }

  return incoming
}

function ReviewControls({ projectId, disabled }) {
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
  }, [projectId])

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

  async function requestReview() {
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
      const data = await createReview(projectId, signal)

      if (signal.aborted) {
        return
      }

      setMessage(data.message)

      if (data.review) {
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

  return (
    <section aria-label="Project reviews">
      <button
        type="button"
        onClick={requestReview}
        disabled={disabled || loading || saving || !ready || Boolean(activeReview) || reconnect}
      >
        {saving ? "Submitting review..." : "Review Entire Project"}
      </button>
      <button
        type="button"
        onClick={() => loadHistory()}
        disabled={disabled || loading || saving}
      >
        Refresh reviews
      </button>
      {loading && <p role="status">Loading review history...</p>}
      {message && <p role="status">{message}</p>}
      {activeReview && <p role="status">Current review: {activeReview.status}</p>}
      {error && <p role="alert">{error}</p>}
      {pollError && <p role="alert">Could not update progress: {pollError}</p>}
      {reconnect && <p><a href={githubLoginUrl}>Reconnect GitHub</a></p>}
      {!loading && ready && reviews.length === 0 && <p>No reviews requested yet.</p>}
      <ul>
        {reviews.map(review => (
          <li key={review._id}>
            <p>
              {review.mode === "entire-project" ? "Entire project" : "Latest changes"}
              {" — "}{review.status}
            </p>
            <p>Commit: <code>{review.commitSha}</code></p>
            {review.stage && <p>Stage: {review.stage}</p>}
            {review.resultMessage && <p>{review.resultMessage}</p>}
            {review.failure && <p>{review.failure.message}</p>}
            <p>Requested: {new Date(review.createdAt).toLocaleString()}</p>
          </li>
        ))}
      </ul>
      {nextCursor && (
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
