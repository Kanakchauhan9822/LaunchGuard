import { apiRequest } from "./api"

export function createReview(projectId, signal) {
  return apiRequest("/reviews", {
    method: "POST",
    signal,
    body: JSON.stringify({
      projectId,
      mode: "entire-project"
    })
  })
}

export function getReview(reviewId, signal) {
  return apiRequest(`/reviews/${encodeURIComponent(reviewId)}`, {
    signal
  })
}

export function listReviews(projectId, cursor, signal) {
  const params = new URLSearchParams({
    projectId
  })

  if (cursor) {
    params.set("cursor", cursor)
  }

  return apiRequest(`/reviews?${params.toString()}`, {
    signal
  })
}
