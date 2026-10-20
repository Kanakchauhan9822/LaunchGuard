const crypto = require("crypto")
const User = require("../models/user.model")
const { encryptToken } = require("../services/token.service")
const {
  exchangeCode,
  getProfile,
  getRepositories,
  githubError
} = require("../services/github.service")
const {
  frontendUrl,
  cookieName,
  cookieOptions,
  setLoginCookie
} = require("../config/auth")

const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api/github"
}

function githubLogin(req, res) {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_REDIRECT_URI) {
    return res.status(503).json({
      message: "GitHub connection is not configured"
    })
  }

  const state = crypto.randomBytes(32).toString("hex")
  const codeVerifier = crypto.randomBytes(32).toString("base64url")
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url")

  const options = {
    ...oauthCookieOptions,
    maxAge: 10 * 60 * 1000
  }

  res.cookie("github_oauth_state", state, options)
  res.cookie("github_code_verifier", codeVerifier, options)

  const githubUrl = new URL("https://github.com/login/oauth/authorize")
  githubUrl.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID)
  githubUrl.searchParams.set("redirect_uri", process.env.GITHUB_REDIRECT_URI)
  githubUrl.searchParams.set("state", state)
  githubUrl.searchParams.set("code_challenge", codeChallenge)
  githubUrl.searchParams.set("code_challenge_method", "S256")

  res.redirect(githubUrl.toString())
}

async function githubCallback(req, res) {
  const { code, state, error } = req.query

  const savedState = req.cookies.github_oauth_state
  const codeVerifier = req.cookies.github_code_verifier

  res.clearCookie("github_oauth_state", oauthCookieOptions)
  res.clearCookie("github_code_verifier", oauthCookieOptions)

  if (
    typeof state !== "string" ||
    typeof savedState !== "string" ||
    !state ||
    state !== savedState
  ) {
    return res.redirect(`${frontendUrl}/?github=invalid-state`)
  }

  if (error) {
    return res.redirect(`${frontendUrl}/?github=cancelled`)
  }

  if (
    typeof code !== "string" ||
    !code ||
    typeof codeVerifier !== "string" ||
    !codeVerifier
  ) {
    return res.redirect(`${frontendUrl}/?github=invalid-state`)
  }

  try {
    const tokenData = await exchangeCode(code, codeVerifier)
    const profile = await getProfile(tokenData.access_token)
    const sessionId = crypto.randomBytes(32).toString("hex")

    const user = await User.findOneAndUpdate(
      {
        githubId: String(profile.id)
      },
      {
        $set: {
          username: profile.login,
          avatarUrl: profile.avatar_url,
          githubToken: encryptToken(tokenData.access_token),
          githubTokenExpiresAt: Number.isFinite(tokenData.expires_in)
            ? new Date(Date.now() + tokenData.expires_in * 1000)
            : null,
          sessionId
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    )

    setLoginCookie(res, user, sessionId)
    res.redirect(frontendUrl)
  } catch {
    res.redirect(`${frontendUrl}/?github=failed`)
  }
}

function getCurrentUser(req, res) {
  res.json({
    user: {
      githubId: req.user.githubId,
      username: req.user.username,
      avatarUrl: req.user.avatarUrl
    },
    selectedRepository: req.user.selectedRepository,
    installationUrl: `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG)}/installations/new`
  })
}

async function logout(req, res) {
  await User.updateOne(
    {
      _id: req.user._id,
      sessionId: req.sessionId
    },
    {
      $unset: {
        sessionId: "",
        githubToken: "",
        githubTokenExpiresAt: ""
      }
    }
  )

  res.clearCookie(cookieName, cookieOptions)

  res.json({
    message: "Signed out"
  })
}

async function listRepositories(req, res) {
  const repositories = await getRepositories(req.user._id, req.sessionId)
  const selected = req.user.selectedRepository

  const selectedRepository = selected
    ? repositories.find(
        repo =>
          repo.id === selected.id &&
          repo.installationId === selected.installationId
      ) || null
    : null

  res.json({
    repositories,
    selectedRepository,
    selectionUnavailable: Boolean(selected && !selectedRepository)
  })
}

async function selectRepository(req, res) {
  const { repositoryId, installationId } = req.body || {}

  if (
    !Number.isSafeInteger(repositoryId) ||
    repositoryId <= 0 ||
    !Number.isSafeInteger(installationId) ||
    installationId <= 0
  ) {
    throw githubError(400, "Choose a valid repository")
  }

  const repositories = await getRepositories(req.user._id, req.sessionId)
  const repository = repositories.find(
    repo =>
      repo.id === repositoryId &&
      repo.installationId === installationId
  )

  if (!repository) {
    throw githubError(
      403,
      "This repository is not accessible through your GitHub connection"
    )
  }

  const result = await User.updateOne(
    {
      _id: req.user._id,
      sessionId: req.sessionId
    },
    {
      $set: {
        selectedRepository: repository
      }
    },
    {
      runValidators: true
    }
  )

  if (!result.matchedCount) {
    throw githubError(401, "Your session has ended. Please sign in again")
  }

  res.json({
    selectedRepository: repository,
    message: "Repository connected"
  })
}

module.exports = {
  githubLogin,
  githubCallback,
  getCurrentUser,
  logout,
  listRepositories,
  selectRepository
}
