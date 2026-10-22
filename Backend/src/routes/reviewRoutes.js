const express = require("express")
const { requireAuth, requireTrustedOrigin } = require("../middlewares/auth.middleware")
const { createReview, getReview, listReviews } = require("../controllers/review.controller")

const router = express.Router()

router.post("/", requireTrustedOrigin, requireAuth, createReview)

router.get("/:reviewId", requireAuth, getReview)

router.get("/", requireAuth, listReviews)



module.exports = router