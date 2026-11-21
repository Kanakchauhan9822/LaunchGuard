import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiRequest } from '../services/api'
import { githubLoginUrl } from '../services/github'
import { Brand } from './Landing'
import ReviewControls from './ReviewControls'
import { pages, openPage, pagePath, readPage, subscribeToPage } from '../navigation'

async function fetchProjectPage(cursor, signal, allProjects = false) {
  if (cursor) {
    return apiRequest('/projects?cursor=' + encodeURIComponent(cursor), { signal })
  }

  const targetId = window.history.state?.projectId
  let data = await apiRequest('/projects', { signal })
  const loaded = [...data.projects]
  while (data.nextCursor && (allProjects || (targetId && !loaded.some(item => item._id === targetId)))) {
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

function ProjectHistory({ project, disabled, onSuccess }) {
  const [open, setOpen] = useState(false)

  return (
    <details className="project-history" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><h2>{project.repositoryName.split('/').pop()}</h2></summary>
      {open && <ReviewControls projectId={project._id} page="history" disabled={disabled} onSuccess={onSuccess} />}
    </details>
  )
}

function Projects({ children, sidebar, selectedRepository, disabled, onSavingChange, onSuccess }) {
  const addDialog = useRef(null)
  const removeDialog = useRef(null)
  const route = useSyncExternalStore(subscribeToPage, readPage)
  const [requestedPage, activeId, reviewId] = route.split('|')
  const page = Object.hasOwn(pages, requestedPage) ? requestedPage : 'dashboard'
  const dashboard = page === 'dashboard'
  const history = page === 'history'
  const [projects, setProjects] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadProjects() {
      try {
        const data = await fetchProjectPage(null, controller.signal, history)
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
  }, [history])

  async function refreshProjects(cursor = null) {
    setLoading(true)
    setError('')

    try {
      const data = await fetchProjectPage(cursor, undefined, history)

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
        openPage(remaining[0]?._id)
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
    openPage(project._id)
    onSuccess('Project saved successfully')
  }

  const project = projects.find(item => item._id === activeId) || projects[0]

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
        <Brand href="/" onClick={event => openPage(project?._id, "dashboard", "", event)} label="LaunchGuard dashboard" />
        <div className="project-tools">
        {project && (
          <nav aria-label="Project navigation">
            {Object.entries(pages).filter(([slug]) => slug !== 'solutions').map(([slug, label]) => (
              <a key={slug} href={pagePath(slug)} onClick={event => openPage(project._id, slug, '', event)} aria-current={page === slug ? 'page' : undefined}>{label}</a>
            ))}
          </nav>
        )}
        <div className="project-actions">
          <button type="button" onClick={() => addDialog.current.showModal()}>+ Add project</button>
          <button type="button" className="refresh-projects" aria-label="Refresh projects" title="Refresh projects"
            onClick={() => refreshProjects()} disabled={disabled || loading}>↻</button>
        </div>
        <button type="button" onClick={() => removeDialog.current.showModal()} disabled={!projects.length || disabled || loading || signedOut}>
          Remove project
        </button>
        <nav className="saved-projects" aria-labelledby="saved-projects-title">
          <strong id="saved-projects-title">Saved projects</strong>
          {projects.map(item => (
            <a key={item._id} href={history ? "/history" : "/"} onClick={event => openPage(item._id, history ? "history" : "dashboard", "", event)} aria-current={item._id === project?._id ? 'true' : undefined}>
              {item.repositoryName.split('/').pop()}
            </a>
          ))}
          {nextCursor && (
            <button type="button" onClick={() => refreshProjects(nextCursor)} disabled={disabled || loading}>
              Load more projects
            </button>
          )}
        </nav>


      </div></>, sidebar)}
      {loading && <p role="status">Loading projects...</p>}
      {error && <p role="alert">{error}</p>}
      {signedOut && <p><a href={githubLoginUrl}>Sign in again</a></p>}

      {dashboard ? (
        <header className="project-hero">
          <span className="eyebrow">Project dashboard</span>
          <h1>{project?.repositoryName?.split('/').pop() || (activeId ? 'Project unavailable' : 'Your first project')}</h1>
          <p>{project?.description || 'Choose Add project to connect a GitHub repository.'}</p>
        </header>
      ) : (
        <h1 className="feature-title">{pages[page]}</h1>
      )}
      {history ? projects.map(item => (
        <ProjectHistory key={item._id} project={item} disabled={disabled || loading || signedOut} onSuccess={onSuccess} />
      )) : project && (
        <ReviewControls key={project._id + ":" + reviewId} initialReviewId={reviewId} onSuccess={onSuccess} projectId={project._id} page={page} disabled={disabled || loading || signedOut} />
      )}
    </section>
  )
}

export default Projects
