import { useEffect, useState } from 'react'
import { apiRequest } from '../services/api'
import { githubLoginUrl } from '../services/github'

function ProjectForm({ repository, disabled, onCreated, onSavingChange }) {
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reconnect, setReconnect] = useState(false)

  async function saveProject(event) {
    event.preventDefault()

    const trimmedDescription = description.trim()

    if (trimmedDescription.length < 10 || trimmedDescription.length > 5000) {
      setError('Description must contain between 10 and 5000 characters')
      return
    }

    setSaving(true)
    onSavingChange(true)
    setError('')
    setReconnect(false)

    try {
      const data = await apiRequest('/projects', {
        method: 'POST',
        body: JSON.stringify({
          description: trimmedDescription,
          repositoryId: repository.id
        })
      })

      setDescription('')
      onCreated(data.project)
    } catch (failure) {
      setError(failure.message)
      setReconnect(failure.status === 401 || failure.code === 'GITHUB_RECONNECT')
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }

  return (
    <form onSubmit={saveProject}>
      <h2>Describe your project</h2>
      <p>Repository: <strong>{repository.fullName}</strong></p>
      <p>Explain what the application should do. Mention features that are still planned.</p>
      <label htmlFor="project-description">Project description</label>
      <p>
        <textarea
          id="project-description"
          value={description}
          onChange={event => setDescription(event.target.value)}
          minLength={10}
          maxLength={5000}
          rows={5}
          cols={60}
          required
          disabled={disabled || saving}
        />
      </p>
      <p>{description.length} / 5000 characters</p>
      {error && <p role="alert">{error}</p>}
      {reconnect && <p><a href={githubLoginUrl}>Reconnect GitHub</a></p>}
      <button type="submit" disabled={disabled || saving}>
        {saving ? 'Saving project...' : 'Save project'}
      </button>
    </form>
  )
}

function Projects({ selectedRepository, disabled, onSavingChange }) {
  const [projects, setProjects] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadProjects() {
      try {
        const data = await apiRequest('/projects', {
          signal: controller.signal
        })

        setProjects(data.projects)
        setNextCursor(data.nextCursor)
      } catch (failure) {
        if (controller.signal.aborted) {
          return
        }

        setError(failure.message)
        setSignedOut(failure.status === 401)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    loadProjects()

    return () => controller.abort()
  }, [])

  async function refreshProjects(cursor = null) {
    setLoading(true)
    setError('')

    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      const data = await apiRequest(`/projects${query}`)

      setProjects(current => {
        if (!cursor) {
          return data.projects
        }

        const existingIds = new Set(current.map(project => project._id))
        return [...current, ...data.projects.filter(project => !existingIds.has(project._id))]
      })
      setNextCursor(data.nextCursor)
      setSignedOut(false)
    } catch (failure) {
      setError(failure.message)

      if (failure.status === 401) {
        setProjects([])
        setNextCursor(null)
        setSignedOut(true)
      }
    } finally {
      setLoading(false)
    }
  }

  function projectCreated(project) {
    setProjects(current => [project, ...current.filter(item => item._id !== project._id)])
    setMessage('Project saved successfully')
  }

  const alreadySaved = selectedRepository && projects.some(
    project => project.repositoryId === selectedRepository.id
  )

  return (
    <section aria-label="Projects">
      {message && <p role="status">{message}</p>}
      {selectedRepository && !alreadySaved && !signedOut && (
        <ProjectForm
          key={selectedRepository.id}
          repository={selectedRepository}
          disabled={disabled || loading}
          onCreated={projectCreated}
          onSavingChange={onSavingChange}
        />
      )}
      {alreadySaved && <p>The selected repository is already saved as a project.</p>}
      {!selectedRepository && <p>Connect a repository above to save a new project.</p>}
      <h2>Saved projects</h2>
      <button type="button" onClick={() => refreshProjects()} disabled={disabled || loading}>
        Refresh projects
      </button>
      {loading && <p role="status">Loading projects...</p>}
      {error && <p role="alert">{error}</p>}
      {signedOut && <p><a href={githubLoginUrl}>Sign in again</a></p>}
      {!loading && !error && projects.length === 0 && <p>No saved projects yet.</p>}
      <ul>
        {projects.map(project => (
          <li key={project._id}>
            <h3>{project.repositoryName}</h3>
            <p>{project.description}</p>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button type="button" onClick={() => refreshProjects(nextCursor)} disabled={disabled || loading}>
          Load more projects
        </button>
      )}
    </section>
  )
}

export default Projects
