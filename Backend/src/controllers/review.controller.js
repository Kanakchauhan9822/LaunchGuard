const mongoose = require("mongoose")
const Project = require("../models/project.model")
const Review = require("../models/review.model")
const Finding = require("../models/finding.model")
const { getLatestCommit } = require("../services/github.service")
const { enqueueReview } = require("../services/review.service")

const improvementFields = "improvementStatus improvements improvementFiles improvementMessage improvementModel"

async function getImprovements(req, res, next) {
  const { reviewId } = req.params

  if (!mongoose.isObjectIdOrHexString(reviewId)) {
    return res.status(400).json({ message: "Please provide a valid review ID" })
  }

  try {
    const review = await Review.findOne({
      _id: reviewId,
      owner: req.user._id
    }).select(improvementFields).lean()

    if (!review) {
      return res.status(404).json({ message: "Review not found" })
    }

    return res.json({ review })
  } catch (error) {
    next(error)
  }
}

async function requestImprovements(req, res, next) {
  const { reviewId } = req.params

  if (!mongoose.isObjectIdOrHexString(reviewId)) {
    return res.status(400).json({ message: "Please provide a valid review ID" })
  }

  const filter = { _id: reviewId, owner: req.user._id }

  try {
    let review = await Review.findOne(filter).select(`${improvementFields} status`).lean()

    if (!review) {
      return res.status(404).json({ message: "Review not found" })
    }

    if (!["completed", "partial"].includes(review.status)) {
      return res.status(409).json({ message: "Complete a project review before requesting suggestions" })
    }

    if (review.improvementStatus === "completed") {
      return res.json({ review })
    }

    if (["pending", "queued", "running"].includes(review.improvementStatus)) {
      return res.status(202).json({ review })
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ message: "AI service is not configured" })
    }

    const claimed = await Review.findOneAndUpdate(
      {
        ...filter,
        improvementStatus: { $in: [null, "failed"] }
      },
      {
        $set: {
          improvementStatus: "pending",
          improvementAttempts: 0,
          improvementMessage: null,
          improvementToken: null,
          improvementExpiresAt: null
        }
      },
      { returnDocument: "after", runValidators: true }
    )

    if (claimed) {
      try {
        await enqueueReview(reviewId, "improvement")
      } catch {
        console.error("Could not confirm suggestion enqueueing; recovery will retry")
      }
    }

    review = await Review.findOne(filter).select(improvementFields).lean()

    if (!review) {
      return res.status(404).json({ message: "Review not found" })
    }

    return res.status(review.improvementStatus === "completed" ? 200 : 202).json({ review })
  } catch (error) {
    next(error)
  }
}


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


async function listFindings(req, res, next) {
  const { reviewId } = req.params
  const { cursor } = req.query

  if (!mongoose.isObjectIdOrHexString(reviewId)) {
    return res.status(400).json({
      message: "Please provide a valid review ID"
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
    const review = await Review.exists({
      _id: reviewId,
      owner: req.user._id
    })

    if (!review) {
      return res.status(404).json({
        message: "Review not found"
      })
    }

    const filter = {
      review: reviewId
    }

    const severities = ["info", "low", "medium", "high", "critical"]
    const pipeline = [
      { $match: { review: new mongoose.Types.ObjectId(reviewId) } },
      { $addFields: { severityRank: { $indexOfArray: [severities, "$severity"] } } }
    ]

    if (cursor) {
      const anchor = await Finding.findOne({
        ...filter,
        _id: cursor
      }).select("severity").lean()

      if (!anchor) {
        return res.status(400).json({
          message: "Findings changed. Reload findings before loading more"
        })
      }

      const severityRank = severities.indexOf(anchor.severity)

      pipeline.push({
        $match: {
          $or: [
            { severityRank: { $lt: severityRank } },
            {
              severityRank,
              _id: { $lt: new mongoose.Types.ObjectId(cursor) }
            }
          ]
        }
      })
    }

    pipeline.push(
      { $sort: { severityRank: -1, _id: -1 } },
      { $limit: 21 },
      {
        $project: {
          __v: 0,
          fingerprint: 0,
          review: 0,
          severityRank: 0,
          explanationToken: 0,
          explanationExpiresAt: 0
        }
      }
    )

    const findings = await Finding.aggregate(pipeline)

    const hasMore = findings.length > 20
    const page = findings.slice(0, 20)

    return res.status(200).json({
      findings: page,
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getImprovements,
  requestImprovements,
  createReview,
  getReview,
  listReviews,
  listFindings
}
