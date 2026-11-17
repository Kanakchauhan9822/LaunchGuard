const express = require("express")
const { requireAuth, requireTrustedOrigin } = require("../middlewares/auth.middleware")
const { createReview, getReview, listReviews, listFindings, getImprovements, requestImprovements } = require("../controllers/review.controller")
const { getFindingExplanation } = require("../controllers/finding.controller")

const router = express.Router()

router.post("/", requireTrustedOrigin, requireAuth, createReview)

router.get("/:reviewId", requireAuth, getReview)

router.get("/:reviewId/findings", requireAuth, listFindings)

router.post("/:reviewId/findings/:findingId/explanation", requireTrustedOrigin, requireAuth, getFindingExplanation)

router.get("/:reviewId/improvements", requireAuth, getImprovements)

router.post("/:reviewId/improvements", requireTrustedOrigin, requireAuth, requestImprovements)

router.get("/", requireAuth, listReviews)



module.exports = router
