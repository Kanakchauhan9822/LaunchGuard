const mongoose = require("mongoose")
const Project = require("../models/project.model")
const Review = require("../models/review.model")
const { getLatestCommit } = require("../services/github.service")
const { enqueueReview } = require("../services/review.service")


async function createReview(req, res, next) {
  const { projectId, mode } = req.body || {}

  if (
    typeof projectId !== "string" ||
    !mongoose.isObjectIdOrHexString(projectId)
  ) {
    return res.status(400).json({
      message: "Please provide a valid project ID"
    })
  }

  if (mode !== "entire-project") {
    return res.status(400).json({
      message: "Only entire-project reviews are supported at this stage"
    })
  }

  try {
    const project = await Project.findOne({
      _id: projectId,
      owner: req.user._id
    })

    if (!project) {
      return res.status(404).json({
        message: "Project not found"
      })
    }

    const existingReview = await Review.findOne({
      owner: req.user._id,
      project: project._id,
      status: { $in: ["pending", "queued", "running"] }
    }).lean()

    if (existingReview) {
      return res.status(200).json({
        message: "A review is already active for this project",
        review: existingReview
      })
    }

    const latestCommit = await getLatestCommit(
      req.user._id,
      req.sessionId,
      project
    )

    const review = await Review.create({
      owner: req.user._id,
      project: project._id,
      mode,
      commitSha: latestCommit.commitSha,
      branch: latestCommit.branch,
      status: "pending"
    })

    let updatedReview

    try {
      await enqueueReview(review._id)
      updatedReview = await Review.findById(review._id).lean()
    } catch {
      console.error("Could not confirm review enqueueing")

      return res.status(202).json({
        message: "Review request saved, but queueing could not be confirmed",
        reviewId: review._id
      })
    }

    return res.status(202).json({
      message: "Review request queued",
      reviewId: review._id,
      review: updatedReview || review
    })
  } catch (error) {
    if (error.code === 11000) {
      try {
        const existingReview = await Review.findOne({
          owner: req.user._id,
          project: projectId,
          status: { $in: ["pending", "queued", "running"] }
        }).lean()

        if (existingReview) {
          return res.status(200).json({
            message: "A review is already active for this project",
            review: existingReview
          })
        }

        return res.status(409).json({
          message: "Review state changed. Refresh review history before retrying"
        })
      } catch (lookupError) {
        return next(lookupError)
      }
    }

    next(error)
  }
}


async function getReview(req, res, next) {
  const { reviewId } = req.params

  if (!mongoose.isObjectIdOrHexString(reviewId)) {
    return res.status(400).json({
      message: "Please provide a valid review ID"
    })
  }

  try {
    const review = await Review.findOne({
      _id: reviewId,
      owner: req.user._id
    })
      .select("-__v")
      .lean()

    if (!review) {
      return res.status(404).json({
        message: "Review not found"
      })
    }

    return res.status(200).json({
      review
    })
  } catch (error) {
    next(error)
  }
}

async function listReviews(req, res, next) {
  const { projectId, cursor } = req.query

  if (
    typeof projectId !== "string" ||
    !mongoose.isObjectIdOrHexString(projectId)
  ) {
    return res.status(400).json({
      message: "Please provide a valid project ID"
    })
  }

  if (
    cursor !== undefined &&
    (
      typeof cursor !== "string" ||
      !mongoose.isObjectIdOrHexString(cursor)
    )
  ) {
    return res.status(400).json({
      message: "Please provide a valid cursor"
    })
  }

  try {
    const project = await Project.exists({
      _id: projectId,
      owner: req.user._id
    })

    if (!project) {
      return res.status(404).json({
        message: "Project not found"
      })
    }

    const filter = {
      project: projectId,
      owner: req.user._id
    }

    if (cursor) {
      filter._id = {
        $lt: cursor
      }
    }

    const reviews = await Review.find(filter)
      .select("-__v -repositoryAnalysis -coverage")
      .sort({ _id: -1 })
      .limit(21)
      .lean()

    const hasMore = reviews.length > 20
    const page = reviews.slice(0, 20)

    return res.status(200).json({
      reviews: page,
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null
    })
  } catch (error) {
    next(error)
  }
}


module.exports = {
  createReview,
  getReview,
  listReviews
}
