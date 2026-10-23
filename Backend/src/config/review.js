const reviewProcessing = {
  maxAttempts: 3,
  timeoutMs: 240000,
  leaseMs: 300000,
  maxSummaryBytes: 4 * 1024 * 1024
}

module.exports = {
  reviewProcessing
}
