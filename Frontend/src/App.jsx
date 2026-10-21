import { useEffect, useState } from 'react'
import { githubLoginUrl, githubRequest } from './services/github'
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

function App() {
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
    const url = new URL(window.location.href)
    url.searchParams.delete('github')
    window.history.replaceState(null, '', url)

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
        if (failure.status === 401) setUser(null)
        else setError(failure.message)
        setReconnect(failure.code === 'GITHUB_RECONNECT')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadConnection()
    return () => controller.abort()
  }, [])

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
      setMessage(data.message)
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
      setUser(null)
      setRepositories([])
      setSelectedRepository(null)
      setMessage('Signed out')
      setReconnect(false)
    } catch (failure) {
      handleError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>LaunchGuard</h1>
      <p>Connect GitHub and choose a repository for your project.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? <p>Loading your connection...</p> : !user ? (
        <a href={githubLoginUrl}>Connect GitHub</a>
      ) : (
        <section aria-label="GitHub connection">
          <p>Connected as <strong>{user.username}</strong></p>
          <button type="button" onClick={logout} disabled={busy}>Sign out</button>
          <p>
            <a href={installationUrl} target="_blank" rel="noopener noreferrer">Install app / manage repository access</a>
          </p>
          <p>After changing access on GitHub, return here and refresh repositories.</p>
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
          {selectedRepository && <p>Selected repository: <strong>{selectedRepository.fullName}</strong></p>}
          <Projects
            key={user.githubId}
            selectedRepository={selectedRepository}
            disabled={busy || reconnect}
            onSavingChange={setBusy}
          />
          <p>Repository scanning will be added in a later feature.</p>
        </section>
      )}
    </main>
  )
}

export default App
