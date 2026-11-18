import { apiRequest } from "./api"

export function createReview(projectId, signal, mode = "entire-project") {
  return apiRequest("/reviews", {
    method: "POST",
    signal,
    body: JSON.stringify({
      projectId,
      mode
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

export function listFindings(reviewId, cursor, signal, changeStatus = "active") {
  const params = new URLSearchParams({ changeStatus, grouped: "true" })

  if (cursor) {
    params.set("cursor", cursor)
  }

  const query = params.size > 0 ? `?${params.toString()}` : ""

  return apiRequest(
    `/reviews/${encodeURIComponent(reviewId)}/findings${query}`,
    { signal }
  )
}

export function explainFinding(reviewId, findingId, signal, regenerate = false) {
  return apiRequest(
    `/reviews/${encodeURIComponent(reviewId)}/findings/${encodeURIComponent(findingId)}/explanation`,
    {
      method: "POST",
      signal,
      body: JSON.stringify({ regenerate })
    }
  )
}

export function getImprovements(reviewId, signal) {
  return apiRequest(`/reviews/${encodeURIComponent(reviewId)}/improvements`, {
    signal
  })
}

export function requestImprovements(reviewId, signal) {
  return apiRequest(`/reviews/${encodeURIComponent(reviewId)}/improvements`, {
    method: "POST",
    signal
  })
}

export function getManualTests(reviewId, signal) {
  return apiRequest(`/reviews/${encodeURIComponent(reviewId)}/manual-tests`, {
    signal
  })
}

export function requestManualTests(reviewId, signal) {
  return apiRequest(`/reviews/${encodeURIComponent(reviewId)}/manual-tests`, {
    method: "POST",
    signal
  })
}

export function markManualTestChecked(reviewId, testId, signal) {
  return apiRequest(`/reviews/${encodeURIComponent(reviewId)}/manual-tests/${encodeURIComponent(testId)}`, {
    method: "PATCH",
    signal
  })
}
