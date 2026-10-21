import { apiRequest } from './api'

export const githubLoginUrl = '/api/github/login'

export function githubRequest(path, options = {}) {
  return apiRequest(`/github${path}`, options)
}
