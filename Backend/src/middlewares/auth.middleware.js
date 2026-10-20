const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")
const User = require("../models/user.model")
const { cookieName, cookieOptions, frontendUrl } = require("../config/auth")

async function requireAuth(req, res, next) {
  let payload

  try {
    payload = jwt.verify(req.cookies[cookieName], process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "launchguard",
      audience: "launchguard-web"
    })

    if (
      !mongoose.isValidObjectId(payload.sub) ||
      typeof payload.sid !== "string"
    ) {
      throw new Error()
    }
  } catch {
    res.clearCookie(cookieName, cookieOptions)

    return res.status(401).json({
      message: "Please sign in with GitHub"
    })
  }

  try {
    const user = await User.findOne({
      _id: payload.sub,
      sessionId: payload.sid
    })

    if (!user) {
      res.clearCookie(cookieName, cookieOptions)

      return res.status(401).json({
        message: "Your session has ended. Please sign in again"
      })
    }

    req.user = user
    req.sessionId = payload.sid
    next()
  } catch (error) {
    next(error)
  }
}

function requireTrustedOrigin(req, res, next) {
  if (req.get("origin") !== new URL(frontendUrl).origin) {
    return res.status(403).json({
      message: "Request origin is not allowed"
    })
  }

  next()
}

module.exports = { requireAuth, requireTrustedOrigin }
