const express = require("express")
const { createProject, listProjects } = require("../controllers/project.controller")
const { requireAuth, requireTrustedOrigin } = require("../middlewares/auth.middleware")

const router = express.Router()

router.post("/", requireTrustedOrigin, requireAuth, createProject)
router.get("/", requireAuth, listProjects)

module.exports = router
