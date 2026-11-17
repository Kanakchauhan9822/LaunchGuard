const mongoose = require("mongoose")

const findingSchema = new mongoose.Schema(
  {
    review: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
      required: true
    },
    tool: {
      type: String,
      enum: ["gitleaks", "osv-scanner", "semgrep", "eslint"],
      required: true
    },
    ruleId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    severity: {
      type: String,
      enum: ["info", "low", "medium", "high", "critical"],
      required: true
    },
    category: {
      type: String,
      enum: ["security", "dependency", "secret", "code-quality"],
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },
    explanation: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    explanationModel: {
      type: String,
      default: null,
      maxlength: 200
    },
    explainedAt: {
      type: Date,
      default: null
    },
    explanationToken: {
      type: String,
      select: false
    },
    explanationExpiresAt: {
      type: Date,
      select: false
    },
    filePath: {
      type: String,
      default: null,
      maxlength: 4096
    },
    startLine: {
      type: Number,
      default: null,
      min: 1,
      validate: value => value === null || Number.isSafeInteger(value)
    },
    endLine: {
      type: Number,
      default: null,
      min: 1,
      validate: value => value === null || Number.isSafeInteger(value)
    },
    fingerprint: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128
    }
  },
  {
    timestamps: true
  }
)

findingSchema.index(
  {
    review: 1,
    tool: 1,
    fingerprint: 1
  },
  {
    unique: true
  }
)

module.exports = mongoose.model("Finding", findingSchema)
