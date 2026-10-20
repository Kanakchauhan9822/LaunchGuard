export const githubLoginUrl = '/api/github/login'

export async function githubRequest(path, options = {}) {
  let response
  try {
    response = await fetch(`/api/github${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(60000),
        ...(options.signal ? [options.signal] : [])
      ])
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Could not reach LaunchGuard. Check that the backend is running and try again', { cause: error })
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(data.message || 'Could not complete the request'), {
      status: response.status,
      code: data.code
    })
  }
  return data
}
