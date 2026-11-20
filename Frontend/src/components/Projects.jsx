import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiRequest } from '../services/api'
import { githubLoginUrl } from '../services/github'
import { Brand } from './Landing'
import ReviewControls from './ReviewControls'


const pages = {
  dashboard: 'Dashboard',
  findings: 'Security findings',
  coding: 'Coding suggestions',
  solutions: 'Solutions',
  checks: 'Manual checks',
  history: 'Review history'
}

function subscribeToPage(listener) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function readPage() {
  return window.location.hash
}

function projectUrl(id, page = 'dashboard') {
  return '#/projects/' + encodeURIComponent(id) + '/' + page
}

async function fetchProjectPage(cursor, signal) {
  if (cursor) {
    return apiRequest('/projects?cursor=' + encodeURIComponent(cursor), { signal })
  }

  const targetId = readPage().slice(2).split('/')[1]
  let data = await apiRequest('/projects', { signal })
  const loaded = [...data.projects]
  while (targetId && data.nextCursor && !loaded.some(item => item._id === targetId)) {
    data = await apiRequest('/projects?cursor=' + encodeURIComponent(data.nextCursor), { signal })
    loaded.push(...data.projects)
  }
  return { projects: loaded, nextCursor: data.nextCursor }
}

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
      <h2>Project brief</h2>
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

function Projects({ children, sidebar, selectedRepository, disabled, onSavingChange, onSuccess }) {
  const addDialog = useRef(null)
  const removeDialog = useRef(null)
  const hash = useSyncExternalStore(subscribeToPage, readPage)
  const [, activeId, requestedPage] = hash.slice(2).split('/')
  const page = Object.hasOwn(pages, requestedPage) ? requestedPage : 'dashboard'
  const dashboard = page === 'dashboard'
  const [projects, setProjects] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadProjects() {
      try {
        const data = await fetchProjectPage(null, controller.signal)
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
      const data = await fetchProjectPage(cursor)

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

  async function removeProject(item) {
    if (disabled || loading || signedOut) return

    onSavingChange(true)
    setError('')
    try {
      await apiRequest('/projects/' + item._id, { method: 'DELETE' })
      removeDialog.current.close()
      const remaining = projects.filter(saved => saved._id !== item._id)
      setProjects(remaining)
      if (project?._id === item._id) {
        window.location.assign(remaining.length ? projectUrl(remaining[0]._id) : '#')
      }
      onSuccess(item.repositoryName + ' removed from your dashboard')
      if (!remaining.length && nextCursor) await refreshProjects()
    } catch (failure) {
      setError(failure.message)
      setSignedOut(failure.status === 401)
    } finally {
      onSavingChange(false)
    }
  }

  function projectCreated(project) {
    addDialog.current.close()
    setProjects(current => [project, ...current.filter(item => item._id !== project._id)])
    window.location.hash = projectUrl(project._id)
    onSuccess('Project saved successfully')
  }

  const HistoryContainer = page === 'history' ? 'details' : 'div'
  const project = activeId ? projects.find(item => item._id === activeId) : projects[0]

  useEffect(() => {
    if (project) {
      document.title = pages[page] + ' · ' + project.repositoryName + ' | LaunchGuard'
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [project, page])
  const alreadySaved = selectedRepository && projects.some(
    project => project.repositoryId === selectedRepository.id
  )

  return (
    <section id="projects" aria-label="Projects">
      <dialog ref={addDialog} className="add-project-dialog" aria-labelledby="add-project-title">
        <header>
          <h2 id="add-project-title">Add project</h2>
          <button type="button" aria-label="Close dialog" onClick={() => addDialog.current.close()}>×</button>
        </header>
        {children}
        {alreadySaved && <p>This repository is already in your saved projects.</p>}
        {selectedRepository && !alreadySaved && !signedOut && (
          <ProjectForm
            key={selectedRepository.id}
            repository={selectedRepository}
            disabled={disabled || loading}
            onCreated={projectCreated}
            onSavingChange={onSavingChange}
          />
        )}
      </dialog>
      <dialog ref={removeDialog} className="add-project-dialog remove-project-dialog" aria-labelledby="remove-project-title">
        <header>
          <h2 id="remove-project-title">Remove project</h2>
          <button type="button" aria-label="Close dialog" onClick={() => removeDialog.current.close()}>&times;</button>
        </header>
        <p>Removing a saved project keeps its GitHub repository and stored reviews.</p>
        <ul className="remove-project-list">
          {projects.map(item => (
            <li key={item._id}>
              <strong>{item.repositoryName}</strong>
              <button type="button" disabled={disabled || loading || signedOut}
                aria-label={'Remove ' + item.repositoryName} onClick={() => removeProject(item)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {!projects.length && !loading && <p>No saved projects.</p>}
        {nextCursor && <button type="button" disabled={disabled || loading || signedOut} onClick={() => refreshProjects(nextCursor)}>Load more projects</button>}
        {error && <p role="alert">{error}</p>}
      </dialog>
      {sidebar && createPortal(<>
        <Brand href={project ? projectUrl(project._id) : "#/projects"} label="LaunchGuard dashboard" />
        <div className="project-tools">
        <nav className="saved-projects" aria-labelledby="saved-projects-title">
          <strong id="saved-projects-title">Saved projects</strong>
          {projects.map(item => (
            <a key={item._id} href={projectUrl(item._id, page === "history" ? "history" : "dashboard")} aria-current={item._id === project?._id ? 'true' : undefined}>
              {item.repositoryName.split('/').pop()}
            </a>
          ))}
          {nextCursor && (
            <button type="button" onClick={() => refreshProjects(nextCursor)} disabled={disabled || loading}>
              Load more projects
            </button>
          )}
        </nav>
        <div className="project-actions">
          <button type="button" onClick={() => addDialog.current.showModal()}>+ Add project</button>
          <button type="button" className="refresh-projects" aria-label="Refresh projects" title="Refresh projects"
            onClick={() => refreshProjects()} disabled={disabled || loading}>↻</button>
        </div>
        <button type="button" onClick={() => removeDialog.current.showModal()} disabled={!projects.length || disabled || loading || signedOut}>
          Remove project
        </button>
      {project && (
        <nav aria-label="Project navigation">
          {Object.entries(pages).filter(([slug]) => slug !== 'solutions').map(([slug, label]) => (
            <a key={slug} href={projectUrl(project._id, slug)} aria-current={page === slug ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
      )}

      </div></>, sidebar)}
      {loading && <p role="status">Loading projects...</p>}
      {error && <p role="alert">{error}</p>}
      {signedOut && <p><a href={githubLoginUrl}>Sign in again</a></p>}

      {activeId && !project && !loading && projects.length > 0 && <a href={projectUrl(projects[0]._id)}>Return to saved projects</a>}
      {dashboard ? (
        <header className="project-hero">
          <span className="eyebrow">Project dashboard</span>
          <h1>{project?.repositoryName?.split('/').pop() || (activeId ? 'Project unavailable' : 'Your first project')}</h1>
          <p>{project?.description || 'Choose Add project to connect a GitHub repository.'}</p>
        </header>
      ) : (
        <h1 className="feature-title">{pages[page]}</h1>
      )}
      {project && (
        <HistoryContainer key={project._id} className={page === 'history' ? 'project-history' : undefined}>
          {page === 'history' && <summary><h2>{project.repositoryName.split('/').pop()}</h2></summary>}
          <ReviewControls onSuccess={onSuccess} projectId={project._id} page={page} disabled={disabled || loading || signedOut} />
        </HistoryContainer>
      )}
    </section>
  )
}

export default Projects
