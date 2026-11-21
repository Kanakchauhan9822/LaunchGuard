import { useEffect, useRef, useState } from 'react'
import { githubLoginUrl, githubRequest } from './services/github'
import { cleanPageUrl } from './navigation'
import Landing from './components/Landing'
import Projects from './components/Projects'
import './App.css'

const callbackMessages = {
  'invalid-state': 'GitHub authorization expired or was invalid. Please connect again.',
  cancelled: 'GitHub authorization was cancelled. You can try again.',
  failed: 'GitHub connection failed. Please try connecting again.'
}

function repositoryKey(repository) {
  return repository ? `${repository.installationId}:${repository.id}` : ''
}

const minSidebarWidth = 200
const maxSidebarWidth = 440

function App() {
  const [sidebarWidth, setSidebarWidth] = useState(266)
  const gripOffset = useRef(0)

  function resizeSidebar(width) {
    setSidebarWidth(Math.max(minSidebarWidth, Math.min(maxSidebarWidth, width)))
  }

  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)

  function notifySuccess(text) {
    setNotice({ text })
  }
  const [sidebar, setSidebar] = useState(null)
  const [user, setUser] = useState(null)
  const [installationUrl, setInstallationUrl] = useState('')
  const [repositories, setRepositories] = useState([])
  const [selectedRepository, setSelectedRepository] = useState(null)
  const [choice, setChoice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadedRepositories, setLoadedRepositories] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(() => callbackMessages[new URLSearchParams(window.location.search).get('github')] || '')
  const [reconnect, setReconnect] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    cleanPageUrl()

    async function loadConnection() {
      try {
        const account = await githubRequest('/me', { signal: controller.signal })
        setUser(account.user)
        setInstallationUrl(account.installationUrl)
        const data = await githubRequest('/repositories', { signal: controller.signal })
        setRepositories(data.repositories)
        setSelectedRepository(data.selectedRepository)
        setChoice(repositoryKey(data.selectedRepository))
        setLoadedRepositories(true)
        if (data.selectionUnavailable) setMessage('Your saved repository is no longer accessible. Choose another repository or update GitHub access.')
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure.status === 401) {
          window.history.replaceState(null, '', '/')
          setUser(null)
        }
        else setError(failure.message)
        setReconnect(failure.code === 'GITHUB_RECONNECT')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadConnection()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!notice) return
    noticeRef.current?.showPopover?.()
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  function handleError(failure) {
    setError(failure.message)
    if (failure.status === 401) {
      setUser(null)
      setRepositories([])
      setSelectedRepository(null)
    }
    setReconnect(failure.code === 'GITHUB_RECONNECT')
  }

  async function refreshRepositories() {
    setBusy(true)
    setError('')
    setMessage('')
    setSelectedRepository(null)
    setRepositories([])
    setChoice('')
    setLoadedRepositories(false)
    try {
      const data = await githubRequest('/repositories')
      setRepositories(data.repositories)
      setSelectedRepository(data.selectedRepository)
      setChoice(repositoryKey(data.selectedRepository))
      setLoadedRepositories(true)
      setReconnect(false)
      if (data.selectionUnavailable) setMessage('Access to your saved repository has changed. Choose an accessible repository.')
    } catch (failure) {
      handleError(failure)
    } finally {
      setBusy(false)
    }
  }

  async function saveRepository(event) {
    event.preventDefault()
    const repository = repositories.find(item => repositoryKey(item) === choice)
    if (!repository) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await githubRequest('/repository', {
        method: 'POST',
        body: JSON.stringify({ repositoryId: repository.id, installationId: repository.installationId })
      })
      setSelectedRepository(data.selectedRepository)
      notifySuccess(data.message)
    } catch (failure) {
      setSelectedRepository(null)
      handleError(failure)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await githubRequest('/logout', { method: 'POST' })
      window.history.replaceState(null, '', '/')
      setUser(null)
      setRepositories([])
      setSelectedRepository(null)
      setMessage('')
      notifySuccess('Signed out')
      setReconnect(false)
    } catch (failure) {
      handleError(failure)
    } finally {
      setBusy(false)
    }
  }

  const successNotice = notice && (
    <div ref={noticeRef} popover="manual" className="success-notice" role="status">{notice.text}</div>
  )

  if (!user) {
    return (
      <>
        <Landing loading={loading} error={error} message={message} />
        {successNotice}
      </>
    )
  }

  return (
    <div className="workspace" style={{ "--sidebar-width": sidebarWidth + "px" }}>
      {successNotice}
      <aside className="workspace-bar" id="workspace-sidebar">

        <div className="side-content" ref={setSidebar} />
        <div className="account">
          {installationUrl && <a className="repo-access" href={installationUrl} target="_blank" rel="noopener noreferrer">Manage repository access ↗</a>}
          <span className="avatar" aria-hidden="true">{user.username?.slice(0, 1).toUpperCase()}</span>
          <strong>{user.username}</strong>
          <button onClick={logout} disabled={busy}>Sign out</button>
        </div>
      </aside>
      <div
        className="sidebar-grip"
        role="separator"
        aria-label="Resize project sidebar"
        aria-controls="workspace-sidebar"
        aria-orientation="vertical"
        aria-valuemin={minSidebarWidth}
        aria-valuemax={maxSidebarWidth}
        aria-valuenow={sidebarWidth}
        aria-valuetext={sidebarWidth + ' pixels'}
        tabIndex={0}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return
          gripOffset.current = event.clientX - sidebarWidth
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            resizeSidebar(event.clientX - gripOffset.current)
          }
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            resizeSidebar(sidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16))
          }
        }}
      />
      <main className="desk">
        <header className="desk-head"><span>Projects / Workspace</span><span className="connection">{reconnect ? 'Reconnect required' : 'GitHub connected'}</span></header>

        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {reconnect && <a className="primary" href={githubLoginUrl}>Reconnect GitHub</a>}
        <Projects
          sidebar={sidebar}
          key={user.githubId}
          selectedRepository={repositoryKey(selectedRepository) === choice ? selectedRepository : null}
          disabled={busy || reconnect}
          onSavingChange={setBusy}
          onSuccess={notifySuccess}
        >
          <>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            {installationUrl && <p><a href={installationUrl} target="_blank" rel="noopener noreferrer">Choose repositories on GitHub ↗</a></p>}
            {reconnect && <p><a href={githubLoginUrl}>Reconnect GitHub</a></p>}
            <button type="button" onClick={refreshRepositories} disabled={busy}>Refresh repositories</button>
            {busy && <p role="status">Please wait...</p>}
            {loadedRepositories && repositories.length === 0 && (
              <p>No accessible repositories found. Install the app on your GitHub account and select at least one repository.</p>
            )}
            {repositories.length > 0 && (
              <form onSubmit={saveRepository}>
                <p>
                  <label htmlFor="repository">Repository </label>
                  <select id="repository" value={choice} onChange={event => setChoice(event.target.value)} disabled={busy || reconnect}>
                    <option value="">Choose a repository</option>
                    {repositories.map(repository => (
                      <option key={repositoryKey(repository)} value={repositoryKey(repository)}>
                        {repository.fullName}{repository.private ? ' (private)' : ''}
                      </option>
                    ))}
                  </select>
                </p>
                <button type="submit" disabled={busy || !choice || reconnect}>Connect repository</button>
              </form>
            )}
          </>
        </Projects>

      </main>
    </div>
  )
}

export default App
