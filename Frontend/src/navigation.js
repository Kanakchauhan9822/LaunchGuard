export const pages = {
  dashboard: 'Dashboard',
  findings: 'Security findings',
  coding: 'Coding suggestions',
  solutions: 'Solutions',
  checks: 'Manual checks',
  history: 'Review history'
}

export function pagePath(page) {
  return Object.hasOwn(pages, page) && page !== 'dashboard' ? '/' + page : '/'
}

export function openPage(projectId, page = 'dashboard', reviewId = '', event) {
  if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) return
  event?.preventDefault()
  const path = pagePath(page)
  const state = window.history.state
  if (window.location.pathname === path && state?.projectId === projectId && state?.reviewId === reviewId) return
  window.history.pushState({ projectId, reviewId }, '', path)
  window.dispatchEvent(new Event('popstate'))
}

export function cleanPageUrl() {
  const [, prefix, id, slug] = window.location.hash.split('/')
  const legacy = prefix === 'projects' && /^[a-f0-9]{24}$/i.test(id)
  const state = legacy ? { projectId: id } : window.history.state
  window.history.replaceState(state, '', pagePath(legacy ? slug : window.location.pathname.slice(1)))
}

export function subscribeToPage(listener) {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function readPage() {
  const state = window.history.state
  return [window.location.pathname.slice(1), state?.projectId, state?.reviewId].join('|')
}
