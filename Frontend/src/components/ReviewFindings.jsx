import { useEffect, useRef, useState } from "react"
import { listFindings } from "../services/reviews"
import PanelDivider from "./PanelDivider"
import FindingCard from "./FindingCard"

function ReviewFindings({ reviewId, compared, solutions }) {
  const findingsPanel = useRef(null)
  const [listShare, setListShare] = useState(40)
  const [selectedId, setSelectedId] = useState(null)
  const [findings, setFindings] = useState([])
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [changeStatus, setChangeStatus] = useState("active")

  useEffect(() => {
    const controller = new AbortController()

    async function loadFindings() {
      const groups = new Map()
      let cursor = null

      try {
        do {
          const data = await listFindings(reviewId, cursor, controller.signal, changeStatus)
          if (controller.signal.aborted) return

          for (const finding of data.findings) {
            groups.set(finding._id, finding)
          }
          cursor = data.nextCursor
        } while (cursor)

        setFindings([...groups.values()])
        setLoaded(true)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadFindings()
    return () => controller.abort()
  }, [reviewId, changeStatus, attempt])

  useEffect(() => {
    const panel = findingsPanel.current
    const grid = panel.closest(".report-grid")

    const observer = new ResizeObserver(() => {
      grid.style.setProperty("--findings-height", panel.offsetHeight + "px")
    })
    observer.observe(panel, { box: "border-box" })

    return () => {
      observer.disconnect()
      grid.style.removeProperty("--findings-height")
    }
  }, [])

  const selected = findings.find(item => item._id === selectedId) || findings[0]

  return (
    <section id="findings" aria-label="Review findings" style={{ "--list-track": listShare + "fr", "--detail-track": (100 - listShare) + "fr" }}>
      {loaded && !solutions && (
        <div className="severity-summary" aria-label="Severity counts for displayed finding groups">
          <strong>Finding groups</strong>
          {["critical", "high", "medium", "low", "info"].map(level => (
            <span key={level} className={'severity ' + level}>{findings.filter(item => item.severity === level).length} {level}</span>
          ))}
        </div>
      )}
      <div ref={findingsPanel} className="finding-list" id="finding-groups">
      <h3>{solutions ? "Choose an issue to fix" : "Security findings"}</h3>
      {compared && (
        <>
          <label>
            Show findings{" "}
            <select value={changeStatus} onChange={event => {
              setChangeStatus(event.target.value)
              setFindings([])
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
          onClick={() => {
            setError("")
            setLoading(true)
            setAttempt(current => current + 1)
          }}
          disabled={loading}
        >
          Retry loading findings
        </button>
      )}

      {loading && <p role="status">Loading findings...</p>}
      {error && <p role="alert">{error}</p>}
      {loaded && findings.length === 0 && <p>No findings match this view.</p>}
      {loaded && findings.length > 0 && (
        <p>Highest severity first</p>
      )}

      <div className="finding-scroll">
        <ul>
          {findings.map(finding => (
            <li key={finding._id}>
              <button className="finding-row" aria-pressed={selected?._id === finding._id} onClick={() => setSelectedId(finding._id)}>
                <span className={'severity ' + finding.severity}>{finding.severity}</span>
                <span>{findingSummary(finding)}<small>{finding.locations?.length || 1} {(finding.locations?.length || 1) === 1 ? 'occurrence' : 'occurrences'}{finding.changeStatus && ' · ' + finding.changeStatus}</small></span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      </div>
      {selected && (
        <PanelDivider label="Resize findings list" controls="finding-groups" share={listShare} onResize={setListShare} />
      )}
      {selected && <FindingCard key={selected._id} reviewId={reviewId} finding={selected} title={findingSummary(selected)} />}
    </section>
  )
}

function findingSummary(finding) {
  if (finding.category === "dependency") {
    return finding.dependency
      ? `${finding.dependency.name} has a known vulnerability`
      : "A dependency has a known vulnerability"
  }

  if (finding.category === "secret") {
    return "A possible secret was found in this file"
  }

  const summaries = {
    "no-unused-vars": "A variable is declared but never used",
    "no-undef": "A name is used without being defined",
    "no-unreachable": "Some code can never run",
    "no-dupe-keys": "An object contains a repeated property",
    "react/jsx-key": "A rendered list item is missing its key",
    "react/jsx-no-undef": "A JSX component name is not defined",
    "react/jsx-no-duplicate-props": "A JSX element has a repeated property"
  }

  if (summaries[finding.ruleId]) {
    return summaries[finding.ruleId]
  }

  if (finding.tool === "semgrep") {
    const securitySummaries = [
      [/database.*injection/, "User input may change what your database searches for"],
      [/database.*tls/, "Your database connection may not be properly protected"],
      [/grpc-insecure|node-tls-reject|electron-allow-http/, "A connection may not protect the data being sent"],
      [/deserialize/, "Loading data may allow unwanted code to run"],
      [/_eval_/, "User input may cause unwanted code to run on your server"],
      [/_exec_/, "User input may run unwanted commands on your server"],
      [/_ssrf_/, "User input may make your server contact an unsafe address"],
      [/_xss_/, "User input may add unsafe code to a web page"],
      [/path-overwrite/, "Unpacking a file may overwrite files outside its folder"],
      [/_traversal_/, "User input may allow access to files that should be private"],
      [/jwt.*exposed-credentials/, "A login token may reveal passwords or other secrets"],
      [/jwt.*exposed-data/, "A login token may reveal private information"],
      [/jwt.*hardcoded|hardcoded-jwt-secret/, "A login secret is written directly in the code"],
      [/jwt-not-revoked/, "A login token may still work after it should stop working"],
      [/jwt-none-algorithm/, "A login token may be accepted without checking who created it"],
      [/cookie-session-no-httponly/, "Page scripts may be able to read the login cookie"],
      [/cookie-session-no-secure/, "A login cookie may be sent over an unprotected connection"],
      [/cookie-session-no-samesite/, "A login cookie may be sent with requests from other websites"],
      [/cookie-session-no-maxage/, "The login cookie has no explicit time limit"],
      [/cookie-session-no-path|cookie-session-no-domain/, "A login cookie may be shared more widely than intended"],
      [/cookie-session-default/, "The login cookie uses its default name"],
      [/cors/, "Other websites may have more access to your API than intended"],
      [/header.*injection/, "User input may change information in the server response"],
      [/header-xss|helmet-feature-disabled/, "A browser security setting may be missing or disabled"],
      [/timing-attack/, "The time a secret check takes may reveal clues about it"],
      [/_crypto_/, "The way this code protects data may be too weak"],
      [/_xml_/, "Reading an XML file may expose data or overload your server"],
      [/_electronjs_/, "A desktop app setting may give web content too much access"]
    ]

    return securitySummaries.find(([pattern]) => pattern.test(finding.ruleId))?.[1]
      || "This code may have a security problem"
  }

  return "This code may have a coding issue"
}

export default ReviewFindings
