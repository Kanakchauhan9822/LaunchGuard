require("dotenv").config()

const app = require("./src/app")
const connectToDB = require("./src/config/database")

const PORT = 3000

async function startServer() {
  try {
    await connectToDB()

    app.listen(PORT, () => {
      console.log(`LaunchGuard API is running on port ${PORT}`)
    })
  } catch (error) {
    console.error("Could not connect to MongoDB. The server was not started.")
    process.exit(1)
  }
}

startServer()