const express = require("express")
const githubController = require("../controllers/github.controller")
const { requireAuth, requireTrustedOrigin } = require("../middlewares/auth.middleware")

const router = express.Router()

router.get("/login", githubController.githubLogin)

router.get("/callback", githubController.githubCallback)
router.get("/me", requireAuth, githubController.getCurrentUser)
router.post("/logout", requireTrustedOrigin, requireAuth, githubController.logout)
router.get("/repositories", requireAuth, githubController.listRepositories)
router.post("/repository", requireTrustedOrigin, requireAuth, githubController.selectRepository)

module.exports = router
