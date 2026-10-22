const express = require("express")
const cors = require("cors")
const githubRoutes = require("./routes/githubRoutes")
const cookieParser = require("cookie-parser")
const { frontendUrl } = require("./config/auth")
const projectRoutes = require("./routes/projectRoutes")
const reviewRoutes = require("./routes/reviewRoutes")

const app = express()

app.use(
  cors({
    origin: new URL(frontendUrl).origin,
    credentials: true
  })
)

app.use(express.json())
app.use(cookieParser())

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store")
  res.set("X-Content-Type-Options", "nosniff")
  next()
})

app.use("/api/github", githubRoutes)

app.use("/api/projects", projectRoutes)

app.use("/api/reviews", reviewRoutes)

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok"
  })
})

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found"
  })
})

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error)
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      message: "Invalid JSON request"
    })
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      message: "Request body is too large"
    })
  }

  res.status(error.publicMessage ? error.status : 500).json({
    message: error.publicMessage || "Could not complete the request. Please try again",
    ...(error.code === "GITHUB_RECONNECT" ? { code: error.code } : {})
  })
})

module.exports = app
