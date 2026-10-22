require("dotenv").config()

const mongoose = require("mongoose")
const connectToDB = require("./src/config/database")
const { validateAuthConfig } = require("./src/config/auth")
const User = require("./src/models/user.model")
const Project = require("./src/models/project.model")
const Review = require("./src/models/review.model")

const PORT = Number(process.env.PORT || 3000)
let server
let stopReviewRecovery = async () => {}
let closeReviewQueue = async () => {}
let shuttingDown = false

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log("Stopping LaunchGuard API")

  const deadline = setTimeout(() => {
    console.error("Shutdown deadline exceeded")
    server?.closeAllConnections()
    process.exit(1)
  }, 25000)

  try {
    const httpClosed = new Promise((resolve, reject) => {
      if (!server?.listening) {
        resolve()
        return
      }

      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })

    await Promise.all([httpClosed, stopReviewRecovery()])
    await closeReviewQueue()
    await mongoose.disconnect()
    clearTimeout(deadline)
    process.exit(exitCode)
  } catch {
    console.error("Could not complete graceful shutdown")
    process.exit(1)
  }
}

async function startServer() {
  let stage = "configuration"

  try {
    validateAuthConfig()

    if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
      throw new Error("Invalid PORT")
    }

    stage = "Redis configuration"
    const queueModule = require("./src/queues/review.queue")
    closeReviewQueue = queueModule.closeReviewQueue
    const { startReviewRecovery } = require("./src/services/review.service")
    const app = require("./src/app")

    stage = "MongoDB connection"
    await connectToDB()
    stage = "database indexes"
    await User.init()
    await Project.init()
    await Review.init()

    stage = "HTTP listener"
    await new Promise((resolve, reject) => {
      server = app.listen(PORT, () => {
        server.removeListener("error", reject)
        resolve()
      })
      server.once("error", reject)
    })

    server.on("error", error => {
      console.error("HTTP server error", { code: error.code })
      void shutdown(1)
    })

    stopReviewRecovery = startReviewRecovery()
    process.on("SIGINT", () => void shutdown())
    process.on("SIGTERM", () => void shutdown())
    console.log(`LaunchGuard API is running on port ${PORT}`)
  } catch (error) {
    console.error(`Server startup failed during ${stage}`, {
      name: error.name,
      code: error.code
    })
    await shutdown(1)
  }
}

void startServer()
