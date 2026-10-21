const mongoose = require("mongoose")

const projectSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    repositoryId: {
      type: Number,
      required: true
    },
    installationId: {
      type: Number,
      required: true
    },
    repositoryName: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 5000
    }
  },
  {
    timestamps: true
  }
)

projectSchema.index(
  {
    owner: 1,
    repositoryId: 1
  },
  {
    unique: true
  }
)

module.exports = mongoose.model("Project", projectSchema)