const mongoose = require("mongoose")

const reviewSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true
    },
    mode: {
      type: String,
      enum: ["latest-changes", "entire-project"],
      required: true
    },
    commitSha: {
      type: String,
      required: true
    },
    baseCommitSha: {
      type: String,
      default: null
    },
    branch: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: [
        "pending",
        "queued",
        "running",
        "partial",
        "completed",
        "failed"
      ],
      default: "pending",
      required: true
    }
  },
  {
    timestamps: true
  }
)

reviewSchema.index(
  {
    owner: 1,
    project: 1
  },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: ["pending", "queued", "running"]
      }
    }
  }
)

reviewSchema.index({ owner: 1, project: 1, _id: -1 })
reviewSchema.index({ status: 1, _id: 1 })

module.exports = mongoose.model("Review", reviewSchema)
