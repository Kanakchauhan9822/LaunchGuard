const express = require("express")
const cors = require("cors")

const app = express()

app.use(express.json())



app.use(cors({
    origin: "http://localhost:5173"
}))


app.get("/api/health", (req, res) => {
    res.json({ status: "ok" })
})

module.exports = app