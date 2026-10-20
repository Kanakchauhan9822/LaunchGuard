require("dotenv").config()

const app = require("./src/app")
const connectToDB = require("./src/config/database")
const { validateAuthConfig } = require("./src/config/auth")
const User = require("./src/models/user.model")

const PORT = 3000

async function startServer() {
  try {
    validateAuthConfig()
    await connectToDB()
    await User.init()

    app.listen(PORT, () => {
      console.log(`LaunchGuard API is running on port ${PORT}`)
    })
  } catch (error) {
    console.error("Server startup failed. Check MongoDB and the required environment settings in .env.example.")
    process.exit(1)
  }
}

startServer()
