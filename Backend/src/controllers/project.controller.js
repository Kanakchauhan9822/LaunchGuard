const Project = require("../models/project.model")
const { getRepositories } = require("../services/github.service")

async function createProject(req, res, next) {
  const { description, repositoryId } = req.body || {}

  if (typeof description !== "string") {
    return res.status(400).json({
      message: "Please provide a project description"
    })
  }

  const trimmedDescription = description.trim()

  if (
    trimmedDescription.length < 10 ||
    trimmedDescription.length > 5000
  ) {
    return res.status(400).json({
      message: "Description must contain between 10 and 5000 characters"
    })
  }

  const selectedRepository = req.user.selectedRepository

  if (!selectedRepository) {
    return res.status(400).json({
      message: "Please select a GitHub repository first"
    })
  }

  if (
    repositoryId !== undefined &&
    repositoryId !== selectedRepository.id
  ) {
    return res.status(409).json({
      message: "Your selected repository changed. Refresh the page before saving"
    })
  }

  try {
    const repositories = await getRepositories(
      req.user._id,
      req.sessionId
    )

    const repository = repositories.find(
      repository =>
        repository.id === selectedRepository.id &&
        repository.installationId === selectedRepository.installationId
    )

    if (!repository) {
      return res.status(403).json({
        message: "You no longer have access to this repository"
      })
    }

    const project = await Project.create({
      owner: req.user._id,
      repositoryId: repository.id,
      installationId: repository.installationId,
      repositoryName: repository.fullName,
      description: trimmedDescription
    })

    return res.status(201).json({
      message: "Project created successfully",
      project
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "You have already added this repository"
      })
    }

    next(error)
  }
}

async function listProjects(req, res, next) {
  const { cursor } = req.query

  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || !/^[a-f0-9]{24}$/i.test(cursor))
  ) {
    return res.status(400).json({
      message: "Invalid project page cursor"
    })
  }

  try {
    const filter = {
      owner: req.user._id
    }

    if (cursor) {
      filter._id = {
        $lt: cursor
      }
    }

    const projects = await Project.find(filter)
      .sort({
        _id: -1
      })
      .limit(21)
      .lean()

    const hasMore = projects.length > 20
    const page = projects.slice(0, 20)

    return res.status(200).json({
      projects: page,
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createProject,
  listProjects
}
