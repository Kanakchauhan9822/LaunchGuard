const express = require("express")
const { requireAuth, requireTrustedOrigin } = require("../middlewares/auth.middleware")
const { createReview, getReview, listReviews, listFindings } = require("../controllers/review.controller")

const router = express.Router()

router.post("/", requireTrustedOrigin, requireAuth, createReview)

router.get("/:reviewId", requireAuth, getReview)

router.get("/:reviewId/findings", requireAuth, listFindings)

router.get("/", requireAuth, listReviews)



module.exports = router
