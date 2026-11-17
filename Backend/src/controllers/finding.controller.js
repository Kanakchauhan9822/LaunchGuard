const mongoose = require("mongoose")
const { randomUUID } = require("node:crypto")
const Finding = require("../models/finding.model")
const Review = require("../models/review.model")
const Project = require("../models/project.model")
const { aiConfig } = require("../config/ai")
const { explainFinding } = require("../services/findingExplanation.service")
const { getFindingContext } = require("../services/findingContext.service")

async function getFindingExplanation(req, res, next) {
  const { reviewId, findingId } = req.params
  const regenerate = req.body?.regenerate === true
  let explanationToken

  if (
    !mongoose.isObjectIdOrHexString(reviewId) ||
    !mongoose.isObjectIdOrHexString(findingId)
  ) {
    return res.status(400).json({
      message: "Please provide valid review and finding IDs"
    })
  }

  try {
    const review = await Review.findOne({
      _id: reviewId,
      owner: req.user._id
    }).select("project owner commitSha").lean()

    if (!review) {
      return res.status(404).json({ message: "Review not found" })
    }

    const filter = { _id: findingId, review: reviewId }
    const finding = await Finding.findOne(filter).lean()

    if (!finding) {
      return res.status(404).json({ message: "Finding not found" })
    }

    if (
      finding.explanation &&
      (
        !regenerate ||
        typeof finding.explanation !== "string"
      )
    ) {
      return res.json({
        explanation: finding.explanation,
        explanationModel: finding.explanationModel,
        explainedAt: finding.explainedAt
      })
    }

    const project = await Project.findOne({
      _id: review.project,
      owner: req.user._id
    }).select("description").lean()

    if (!project) {
      return res.status(404).json({
        message: "Project not found"
      })
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ message: "AI service is not configured" })
    }

    const token = randomUUID()
    const claimed = await Finding.findOneAndUpdate(
      {
        ...filter,
        explanation: finding.explanation || null,
        $or: [
          { explanationExpiresAt: null },
          { explanationExpiresAt: { $lte: new Date() } }
        ]
      },
      {
        $set: {
          explanationToken: token,
          explanationExpiresAt: new Date(Date.now() + aiConfig.timeoutMs + 30000)
        }
      },
      { returnDocument: "after" }
    )

    if (!claimed) {
      return res.status(409).json({
        message: "An explanation is already being generated or was just saved. Please try again shortly"
      })
    }

    explanationToken = token
    const context = await getFindingContext(review, claimed).catch(() => null)

    const explanation = await explainFinding(
      claimed,
      project.description,
      context
    )
    const saved = await Finding.findOneAndUpdate(
      { ...filter, explanationToken },
      {
        $set: {
          explanation,
          explanationModel: aiConfig.model,
          explainedAt: new Date()
        },
        $unset: { explanationToken: "", explanationExpiresAt: "" }
      },
      { returnDocument: "after", runValidators: true }
    ).lean()

    if (!saved) {
      return res.status(409).json({
        message: "The finding changed. Reload findings before trying again"
      })
    }

    return res.json({
      explanation: saved.explanation,
      explanationModel: saved.explanationModel,
      explainedAt: saved.explainedAt
    })
  } catch (error) {
    if (!explanationToken) {
      return next(error)
    }

    return res.status(502).json({
      message: "Could not generate or save the explanation. Please try again"
    })
  } finally {
    if (explanationToken) {
      await Finding.updateOne(
        { _id: findingId, explanationToken },
        { $unset: { explanationToken: "", explanationExpiresAt: "" } }
      ).catch(() => console.error("Could not release finding explanation claim"))
    }
  }
}

module.exports = {
  getFindingExplanation
}
