const mongoose = require("mongoose")
const { randomUUID } = require("node:crypto")
const Finding = require("../models/finding.model")
const Review = require("../models/review.model")
const Project = require("../models/project.model")
const { aiConfig } = require("../config/ai")
const { explainFinding, findingGroupIdentity } = require("../services/findingExplanation.service")
const { getFindingContext } = require("../services/findingContext.service")

async function getFindingExplanation(req, res, next) {
  const { reviewId, findingId } = req.params
  const regenerate = req.body?.regenerate === true
  let explanationToken
  let explanationFindingId = findingId

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

    const requested = await Finding.findOne({ _id: findingId, review: reviewId }).lean()

    if (!requested) {
      return res.status(404).json({ message: "Finding not found" })
    }

    if (requested.changeStatus === "resolved") {
      return res.status(409).json({ message: "This finding was not detected in the current scan or its file was removed" })
    }

    const [identity] = await Finding.aggregate([
      { $match: { _id: requested._id, review: review._id } },
      { $project: { key: findingGroupIdentity } }
    ])

    if (!identity) {
      return res.status(404).json({ message: "Finding not found" })
    }

    const groupFilter = {
      review: reviewId,
      $expr: { $eq: [findingGroupIdentity, { $literal: identity.key }] }
    }
    const finding = await Finding.findOne(groupFilter).sort({ _id: 1 }).lean()

    if (!finding) {
      return res.status(404).json({ message: "Finding not found" })
    }

    explanationFindingId = finding._id
    const filter = { _id: finding._id, review: reviewId }

    if (!finding.explanationShared && finding.explanation && typeof finding.explanation !== "string") {
      const different = await Finding.exists({
        ...groupFilter,
        explanation: { $ne: finding.explanation }
      })

      if (!different) {
        const reused = await Finding.updateOne(
          {
            ...filter,
            explanation: finding.explanation,
            $or: [
              { explanationExpiresAt: null },
              { explanationExpiresAt: { $lte: new Date() } }
            ]
          },
          { $set: { explanationShared: true } }
        )
        finding.explanationShared = reused.matchedCount > 0
      }
    }

    if (
      finding.explanationShared &&
      finding.explanation &&
      (!regenerate || typeof finding.explanation !== "string")
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
    const context = await getFindingContext({
      ...review,
      commitSha: claimed.observedCommitSha || review.commitSha,
      mode: "entire-project"
    }, claimed).catch(() => null)

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
          explanationShared: true,
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
    if (
      !explanationToken ||
      ["AI_HIGH_DEMAND", "AI_RATE_LIMIT"].includes(error.code)
    ) {
      return next(error)
    }

    return res.status(502).json({
      message: "Could not generate or save the explanation. Please try again"
    })
  } finally {
    if (explanationToken) {
      await Finding.updateOne(
        { _id: explanationFindingId, explanationToken },
        { $unset: { explanationToken: "", explanationExpiresAt: "" } }
      ).catch(() => console.error("Could not release finding explanation claim"))
    }
  }
}

module.exports = {
  getFindingExplanation
}
