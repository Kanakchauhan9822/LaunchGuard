const User = require("../models/user.model")
const { decryptToken } = require("./token.service")

function githubError(status, message, code) {
  return Object.assign(new Error(message), {
    status,
    publicMessage: message,
    code
  })
}

async function createClient(token, signal = AbortSignal.timeout(45000)) {
  const { Octokit } = await import("@octokit/rest")

  return new Octokit({
    auth: token,
    userAgent: "LaunchGuard",
    request: {
      fetch: (url, options) =>
        fetch(url, {
          ...options,
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(10000),
            ...(options?.signal ? [options.signal] : [])
          ])
        })
    }
  })
}

async function exchangeCode(code, codeVerifier) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      redirect_uri: process.env.GITHUB_REDIRECT_URI,
      code,
      code_verifier: codeVerifier
    }),
    signal: AbortSignal.timeout(10000)
  })

  const data = await response.json()

  if (
    !response.ok ||
    data.error ||
    typeof data.access_token !== "string" ||
    !data.access_token
  ) {
    throw githubError(502, "Could not complete GitHub authorization")
  }

  return data
}

async function getProfile(token) {
  const client = await createClient(token)
  const { data } = await client.rest.users.getAuthenticated()

  if (!Number.isSafeInteger(data.id) || !data.login) {
    throw githubError(502, "Invalid GitHub profile")
  }

  return data
}

async function getAuthenticatedClient(userId, sessionId) {
  const user = await User.findOne({
    _id: userId,
    sessionId
  }).select("+githubToken")

  if (!user) {
    throw githubError(401, "Please sign in again")
  }

  if (
    !user.githubToken ||
    (user.githubTokenExpiresAt && user.githubTokenExpiresAt <= new Date())
  ) {
    throw githubError(
      409,
      "Your GitHub authorization expired. Reconnect GitHub",
      "GITHUB_RECONNECT"
    )
  }

  return createClient(decryptToken(user.githubToken))
}

async function getRepositories(userId, sessionId) {
  const client = await getAuthenticatedClient(userId, sessionId)

  try {
    const installations = await client.paginate("GET /user/installations", {
      per_page: 100
    })

    const repositories = []

    for (const installation of installations) {
      if (
        String(installation.app_id) !== process.env.GITHUB_APP_ID ||
        installation.suspended_at
      ) {
        continue
      }

      const accessible = await client.paginate(
        "GET /user/installations/{installation_id}/repositories",
        {
          installation_id: installation.id,
          per_page: 100
        }
      )

      for (const repo of accessible) {
        repositories.push({
          id: repo.id,
          installationId: installation.id,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url
        })
      }
    }

    return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName))
  } catch (error) {
    if (error.status === 401) {
      throw githubError(
        409,
        "GitHub authorization was revoked or expired. Reconnect GitHub",
        "GITHUB_RECONNECT"
      )
    }

    if (error.status === 403 || error.status === 429) {
      throw githubError(
        503,
        "GitHub denied access or temporarily limited requests. Check app permissions and try again"
      )
    }

    throw githubError(502, "Could not load GitHub repositories. Please try again")
  }
}

async function getLatestCommit(userId, sessionId, project) {
  const repositories = await getRepositories(userId, sessionId)

  const repository = repositories.find(
    repository =>
      repository.id === project.repositoryId &&
      repository.installationId === project.installationId
  )

  if (!repository) {
    throw githubError(403, "You no longer have access to this repository")
  }

  const client = await getAuthenticatedClient(userId, sessionId)
  const [owner, repo] = repository.fullName.split("/")

  try {
    const { data } = await client.rest.repos.getCommit({
      owner,
      repo,
      ref: repository.defaultBranch
    })

    return {
      commitSha: data.sha,
      branch: repository.defaultBranch
    }
  } catch (error) {
    if (error.status === 401) {
      throw githubError(
        409,
        "GitHub authorization expired. Reconnect GitHub",
        "GITHUB_RECONNECT"
      )
    }

    if (error.status === 404) {
      throw githubError(
        404,
        "The repository or its default branch is no longer accessible"
      )
    }

    if (error.status === 409) {
      throw githubError(
        409,
        "GitHub could not resolve a commit. The repository may be empty"
      )
    }

    if (error.status === 403 || error.status === 429) {
      throw githubError(
        503,
        "GitHub denied access or temporarily limited requests. Please try again"
      )
    }

    throw githubError(
      502,
      "Could not retrieve the latest commit from GitHub"
    )
  }
}

module.exports = {
  exchangeCode,
  getProfile,
  getRepositories,
  getLatestCommit,
  githubError
}
