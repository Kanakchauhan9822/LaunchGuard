import { useEffect, useRef, useState } from "react"
import { getManualTests, requestManualTests, markManualTestChecked } from "../services/reviews"

const activeStatuses = new Set(["pending", "queued", "running"])

function ReviewManualTests({ reviewId, disabled }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [refreshVersion, setRefreshVersion] = useState(0)
  const request = useRef(null)
  const active = activeStatuses.has(result?.manualTestStatus)
  const wholeApplication = result?.manualTestVersion >= 2
  const completed = result?.manualTestStatus === "completed" && wholeApplication
  const legacy = result?.manualTestStatus === "completed" && !wholeApplication
  const coverage = result?.manualTestCoverage
  let buttonLabel = "Generate manual checks"

  if (legacy) {
    buttonLabel = "Review whole application"
  } else if (coverage?.completedParts > 0) {
    buttonLabel = "Continue manual checks"
  } else if (result?.manualTestStatus === "failed") {
    buttonLabel = "Try generating checks again"
  }

  useEffect(() => {
    return () => request.current?.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer

    async function load() {
      try {
        const data = await getManualTests(reviewId, controller.signal)

        if (controller.signal.aborted) {
          return
        }

        setResult(data.review)
        setError("")
        setLoading(false)

        if (activeStatuses.has(data.review.manualTestStatus)) {
          timer = setTimeout(load, 3000)
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setLoading(false)
          setError(failure.message)
        }
      }
    }

    void load()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [reviewId, refreshVersion])

  async function save(testId = null) {
    if (request.current || loading || disabled || active) {
      return
    }

    if (testId && !window.confirm("Mark this check as checked?")) {
      return
    }

    const controller = new AbortController()
    request.current = controller
    setSaving(true)
    setError("")

    try {
      const data = testId
        ? await markManualTestChecked(reviewId, testId, controller.signal)
        : await requestManualTests(reviewId, controller.signal)

      if (!controller.signal.aborted) {
        setResult(data.review)

        if (activeStatuses.has(data.review.manualTestStatus)) {
          setRefreshVersion(current => current + 1)
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure.message)
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setSaving(false)
      }
    }
  }

  return (
    <section aria-label="Manual checks">
      <h4>Manual checks</h4>
      {!completed && !active && result && (
        <button type="button" onClick={() => save()} disabled={disabled || loading || saving}>
          {buttonLabel}
        </button>
      )}
      {(loading || active || (saving && !completed)) && !error && (
        <div role="status" aria-label="Preparing manual checks">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      )}
      {coverage?.eligibleFiles > 0 && (
        <p role="status">
          Manual checks reviewed {coverage.reviewedFiles} of {coverage.eligibleFiles} eligible JavaScript/TypeScript files.
          {active && ` Processed ${coverage.completedParts} of ${coverage.totalParts} code sections.`}
        </p>
      )}
      {coverage?.excluded?.length > 0 && (
        <details>
          <summary>Files not reviewed ({coverage.excluded.length})</summary>
          <ul>
            {coverage.excluded.map(file => <li key={file.path}>{file.path}: {file.reason}</li>)}
          </ul>
        </details>
      )}
      {legacy && <p>These saved checks used a limited code sample. Review the whole application to extend them.</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" disabled={disabled || saving} onClick={() => {
            setError("")
            setRefreshVersion(current => current + 1)
          }}>
            Refresh checks
          </button>
        </>
      )}
      {result?.manualTestStatus === "failed" && !error && (
        <p role="alert">{result.manualTestMessage || "Manual checks could not be generated. Please try again."}</p>
      )}
      {(completed || result?.manualTests?.length > 0) && (
        <>
          <details>
            <summary>Show saved manual checks</summary>
            {result.manualTestFiles?.length > 0 && (
              <p>Checks based on your description and reviewed files: {result.manualTestFiles.join(", ")}.</p>
            )}
            {result.manualTestMessage && <p>{result.manualTestMessage}</p>}
            {!result.manualTestMessage && result.manualTests.length === 0 && (
              <p>No useful manual checks could be suggested from the available context.</p>
            )}
            <ul>
              {result.manualTests.map(test => (
                <li key={test._id}>
                  <details>
                    <summary>{test.title}{test.checkedAt ? " — Checked" : ""}</summary>
                    {test.preparation && <p><strong>Before you start:</strong> {test.preparation}</p>}
                    <ol>
                      {test.steps.map((step, index) => <li key={index}>{step}</li>)}
                    </ol>
                    <p><strong>Expected result:</strong> {test.expectedResult}</p>
                    <button
                      type="button"
                      onClick={() => save(test._id)}
                      disabled={disabled || saving || loading || active || result.manualTestStatus !== "completed" || Boolean(test.checkedAt)}
                    >
                      {test.checkedAt ? "Checked" : "Mark as checked"}
                    </button>
                  </details>
                </li>
              ))}
            </ul>
          </details>
          <p>For updated checks, push your code changes and run Review Entire Project again.</p>
        </>
      )}
    </section>
  )
}

export default ReviewManualTests
