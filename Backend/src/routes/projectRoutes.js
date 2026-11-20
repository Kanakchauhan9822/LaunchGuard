const express = require("express")
const { createProject, listProjects, removeProject } = require("../controllers/project.controller")
const { requireAuth, requireTrustedOrigin } = require("../middlewares/auth.middleware")

const router = express.Router()

router.post("/", requireTrustedOrigin, requireAuth, createProject)
router.get("/", requireAuth, listProjects)

router.delete("/:projectId", requireTrustedOrigin, requireAuth, removeProject)

module.exports = router
