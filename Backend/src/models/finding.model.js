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
    changeStatus: {
      type: String,
      enum: ["new", "existing", "resolved"],
      default: null
    },
    observedCommitSha: {
      type: String,
      default: null
    },
    rechecked: {
      type: Boolean,
      default: true
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
    dependency: {
      type: new mongoose.Schema(
        {
          name: { type: String, required: true, maxlength: 214 },
          version: { type: String, required: true, maxlength: 256 },
          fixedVersions: {
            type: [{ type: String, maxlength: 256 }],
            default: [],
            validate: values => values.length <= 20
          }
        },
        { _id: false }
      ),
      default: null
    },
    explanation: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    explanationShared: {
      type: Boolean,
      default: false
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
