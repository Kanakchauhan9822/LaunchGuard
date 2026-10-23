const mongoose = require("mongoose")

const dependencySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    version: {
      type: String,
      required: true
    },
    section: {
      type: String,
      enum: ["dependencies", "devDependencies"],
      required: true
    },
    path: {
      type: String,
      required: true
    }
  },
  { _id: false }
)

const technologySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    category: {
      type: String,
      required: true
    },
    dependency: {
      type: String,
      required: true
    },
    version: {
      type: String,
      required: true
    },
    section: {
      type: String,
      enum: ["dependencies", "devDependencies"],
      required: true
    },
    path: {
      type: String,
      required: true
    },
    evidence: {
      type: String,
      enum: ["declared-dependency"],
      required: true
    }
  },
  { _id: false }
)

const packageSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true
    },
    directory: {
      type: String,
      required: true
    },
    name: {
      type: String,
      default: null
    },
    dependencies: {
      type: [dependencySchema],
      default: []
    },
    technologies: {
      type: [technologySchema],
      default: []
    }
  },
  { _id: false }
)

const packageManagerSchema = new mongoose.Schema(
  {
    manager: {
      type: String,
      enum: ["npm", "yarn", "pnpm", "bun"],
      required: true
    },
    path: {
      type: String,
      required: true
    },
    directory: {
      type: String,
      required: true
    },
    evidence: {
      type: String,
      enum: ["lockfile-presence"],
      required: true
    }
  },
  { _id: false }
)

const inspectionWarningSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      enum: [
        "invalid-package-json",
        "invalid-package-manifest",
        "invalid-dependency-section",
        "invalid-dependency-declaration",
        "conflicting-package-manager-lockfiles"
      ],
      required: true
    },
    path: String,
    directory: String,
    section: String,
    name: String,
    managers: {
      type: [String],
      default: undefined
    },
    paths: {
      type: [String],
      default: undefined
    }
  },
  { _id: false }
)

const repositoryAnalysisSchema = new mongoose.Schema(
  {
    packages: {
      type: [packageSchema],
      default: []
    },
    packageManagers: {
      type: [packageManagerSchema],
      default: []
    },
    warnings: {
      type: [inspectionWarningSchema],
      default: []
    }
  },
  { _id: false }
)

const skippedFileSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true
    },
    reason: {
      type: String,
      enum: [
        "unsafe-or-unsupported-path",
        "symbolic-link",
        "submodule",
        "unsupported-entry-type",
        "ignored-directory",
        "binary-extension",
        "file-size-limit",
        "binary-content",
        "unsupported-text-encoding",
        "git-lfs-pointer"
      ],
      required: true
    },
    size: {
      type: Number,
      min: 0,
      validate: Number.isSafeInteger
    }
  },
  { _id: false }
)

const coverageSchema = new mongoose.Schema(
  {
    treeEntryCount: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger
    },
    retainedFileCount: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger
    },
    downloadedBytes: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger
    },
    selectedBytes: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger
    },
    skipped: {
      type: [skippedFileSchema],
      default: []
    }
  },
  { _id: false }
)

const failureSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      maxlength: 100
    },
    message: {
      type: String,
      required: true,
      maxlength: 500
    }
  },
  { _id: false }
)

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
    processingToken: {
      type: String,
      default: null,
      select: false
    },
    processingExpiresAt: {
      type: Date,
      default: null,
      select: false
    },
    processingAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false
    },
    resultMessage: {
      type: String,
      default: null,
      maxlength: 500
    },
    repositoryAnalysis: {
      type: repositoryAnalysisSchema,
      default: null
    },
    coverage: {
      type: coverageSchema,
      default: null
    },
    failure: {
      type: failureSchema,
      default: null
    },
    stage: {
      type: String,
      enum: [
        "waiting",
        "checking-access",
        "fetching-files",
        "inspecting-repository",
        "repository-ready"
      ],
      default: "waiting",
      required: true
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
