const jwt = require("jsonwebtoken")

const cookieName = "launchguard_token"
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api"
}

function validateAuthConfig() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters")
  }

  if (!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || "")) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte hexadecimal key")
  }

  for (const name of [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_REDIRECT_URI",
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG"
  ]) {
    if (!process.env[name]) {
      throw new Error(`${name} is required`)
    }
  }

  new URL(frontendUrl)
  new URL(process.env.GITHUB_REDIRECT_URI)
}

function setLoginCookie(res, user, sessionId) {
  const token = jwt.sign(
    {
      sid: sessionId
    },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      subject: user._id.toString(),
      issuer: "launchguard",
      audience: "launchguard-web",
      expiresIn: "7d"
    }
  )

  res.cookie(cookieName, token, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000
  })
}

module.exports = {
  cookieName,
  cookieOptions,
  frontendUrl,
  validateAuthConfig,
  setLoginCookie
}
