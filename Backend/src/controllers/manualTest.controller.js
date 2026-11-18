const mongoose = require("mongoose")
const { createHash } = require("node:crypto")
const Review = require("../models/review.model")
const Project = require("../models/project.model")
const { aiConfig } = require("../config/ai")
const { enqueueReview } = require("../services/review.service")

const manualTestFields = "manualTests manualTestStatus manualTestFiles manualTestMessage manualTestVersion manualTestCoverage"

async function findManualTestReview(req) {
  const { reviewId } = req.params

  if (!mongoose.isObjectIdOrHexString(reviewId)) {
    throw Object.assign(new Error("Invalid review ID"), {
      status: 400,
      publicMessage: "Please provide a valid review ID"
    })
  }

  const review = await Review.findOne({
    _id: reviewId,
    owner: req.user._id
  }).select(`${manualTestFields} owner project commitSha status +manualTestKey`).lean()

  const project = review && await Project.findOne({
    _id: review.project,
    owner: req.user._id
  }).select("description").lean()

  if (!review || !project) {
    throw Object.assign(new Error("Review not found"), {
      status: 404,
      publicMessage: "Review not found"
    })
  }

  const key = createHash("sha256").update(JSON.stringify([
    String(review.owner),
    String(review.project),
    review.commitSha,
    project.description
  ])).digest("hex")

  const saved = await Review.findOne({
    owner: req.user._id,
    manualTestKey: key
  }).select(manualTestFields).lean()

  return { review, project, key, saved }
}

async function getManualTests(req, res, next) {
  try {
    const { saved } = await findManualTestReview(req)

    return res.json({
      review: saved || {
        manualTests: [],
        manualTestStatus: null,
        manualTestFiles: [],
        manualTestMessage: null
      }
    })
  } catch (error) {
    next(error)
  }
}

async function requestManualTests(req, res, next) {
  try {
    const { review, project, key, saved } = await findManualTestReview(req)

    if (!["completed", "partial"].includes(review.status)) {
      return res.status(409).json({
        message: "Complete a project review before generating manual checks"
      })
    }

    const currentVersion = saved?.manualTestVersion === aiConfig.manualTestVersion
    const active = ["pending", "queued", "running"].includes(saved?.manualTestStatus)

    if (saved && (active || (saved.manualTestStatus === "completed" && currentVersion))) {
      return res.status(saved.manualTestStatus === "completed" ? 200 : 202).json({ review: saved })
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ message: "AI service is not configured" })
    }

    const claimed = await Review.findOneAndUpdate(
      {
        _id: saved?._id || review._id,
        owner: req.user._id,
        manualTestStatus: { $in: [null, "failed", ...(!currentVersion ? ["completed"] : [])] },
        ...(!saved ? {
          manualTestKey: review.manualTestKey || { $exists: false }
        } : {})
      },
      {
        $set: {
          manualTestKey: key,
          ...(!saved ? { manualTests: [] } : {}),
          ...(!currentVersion ? {
            manualTestFiles: [],
            manualTestCompletedParts: [],
            manualTestCoverage: {}
          } : {}),
          manualTestVersion: aiConfig.manualTestVersion,
          manualTestDescription: project.description,
          manualTestStatus: "pending",
          manualTestAttempts: 0,
          manualTestMessage: null,
          manualTestToken: null,
          manualTestExpiresAt: null
        }
      },
      { returnDocument: "after", runValidators: true }
    )

    if (claimed) {
      try {
        await enqueueReview(claimed._id, "manualTest")
      } catch {
        console.error("Could not confirm manual check enqueueing; recovery will retry")
      }
    }

    const current = await Review.findOne({
      owner: req.user._id,
      manualTestKey: key
    }).select(manualTestFields).lean()

    if (!current) {
      return res.status(409).json({
        message: "Another set of checks is being prepared. Refresh checks before trying again."
      })
    }

    return res.status(current.manualTestStatus === "completed" ? 200 : 202).json({ review: current })
  } catch (error) {
    if (error.code === 11000) {
      return getManualTests(req, res, next)
    }

    next(error)
  }
}

async function markManualTestChecked(req, res, next) {
  const { testId } = req.params

  if (!mongoose.isObjectIdOrHexString(testId)) {
    return res.status(400).json({ message: "Please provide a valid check ID" })
  }

  try {
    const { saved } = await findManualTestReview(req)

    if (!saved || !saved.manualTests.some(test => String(test._id) === testId)) {
      return res.status(404).json({ message: "Manual check not found" })
    }

    await Review.updateOne(
      {
        _id: saved._id,
        owner: req.user._id,
        manualTestStatus: "completed",
        manualTests: { $elemMatch: { _id: testId, checkedAt: null } }
      },
      { $set: { "manualTests.$.checkedAt": new Date() } },
      { runValidators: true }
    )

    const review = await Review.findOne({
      _id: saved._id,
      owner: req.user._id
    }).select(manualTestFields).lean()

    return res.json({ review })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getManualTests,
  requestManualTests,
  markManualTestChecked
}
