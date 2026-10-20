const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
  {
    githubId: {
      type: String,
      required: true,
      unique: true
    },
    username: {
      type: String,
      required: true
    },
    avatarUrl: String,
    githubToken: {
      type: String,
      select: false
    },
    githubTokenExpiresAt: Date,
    sessionId: {
      type: String,
      select: false
    },
    selectedRepository: {
      type: new mongoose.Schema(
        {
          id: {
            type: Number,
            required: true
          },
          installationId: {
            type: Number,
            required: true
          },
          fullName: {
            type: String,
            required: true
          },
          private: Boolean,
          defaultBranch: String,
          htmlUrl: String
        },
        {
          _id: false
        }
      ),
      default: null
    }
  },
  {
    timestamps: true
  }
)

module.exports = mongoose.model("User", userSchema)
