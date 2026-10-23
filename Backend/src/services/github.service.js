const User = require("../models/user.model")
const { decryptToken } = require("./token.service")
const { createHash } = require("node:crypto")
const { repositoryLimits } = require("../config/repository")

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

async function getAuthenticatedToken(userId, sessionId) {
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

  return decryptToken(user.githubToken)
}

async function getAuthenticatedClient(userId, sessionId, signal) {
  const token = await getAuthenticatedToken(userId, sessionId)
  const signals = [AbortSignal.timeout(45000)]

  if (signal) {
    signals.push(signal)
  }

  return createClient(token, AbortSignal.any(signals))
}

async function getRepositories(userId, sessionId, signal) {
  const client = await getAuthenticatedClient(userId, sessionId, signal)

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

async function getRepositoryTree(userId, sessionId, repository, commitSha, signal) {
  if (
    typeof commitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(commitSha)
  ) {
    throw githubError(400, "The review has an invalid commit SHA")
  }

  const client = await getAuthenticatedClient(userId, sessionId, signal)
  const [owner, repo] = repository.fullName.split("/")

  try {
    const { data: commit } = await client.rest.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha
    })

    const { data } = await client.rest.git.getTree({
      owner,
      repo,
      tree_sha: commit.tree.sha,
      recursive: "1"
    })

    if (data.truncated) {
      throw githubError(
        422,
        "GitHub returned an incomplete file list. This repository exceeds the current review limits"
      )
    }

    return data.tree
  } catch (error) {
    if (error.publicMessage) {
      throw error
    }

    if (error.status === 401) {
      throw githubError(
        401,
        "GitHub authorization expired. Please reconnect GitHub",
        "GITHUB_RECONNECT"
      )
    }

    if (error.status === 404) {
      throw githubError(
        404,
        "The repository or saved commit is no longer accessible"
      )
    }

    if (error.status === 403 || error.status === 429) {
      throw githubError(
        503,
        "GitHub denied access or temporarily limited requests"
      )
    }

    throw githubError(
      502,
      "Could not retrieve the repository file list"
    )
  }
}

async function createRepositoryBlobReader(userId, sessionId, repository) {
  const token = await getAuthenticatedToken(userId, sessionId)
  const [owner, repo] = repository.fullName.split("/")
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`

  return async function readBlob(file, signal, accountBytes) {
    if (
      !/^[a-f0-9]{40}$/i.test(file.sha || "") ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > repositoryLimits.maxFileBytes
    ) {
      throw githubError(422, "Invalid selected file metadata")
    }

    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(repositoryLimits.fileTimeoutMs)
    ])
    let reader
    let finished = false

    try {
      const response = await fetch(`${baseUrl}/${file.sha}`, {
        headers: {
          Accept: "application/vnd.github.raw+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "LaunchGuard"
        },
        redirect: "error",
        signal: requestSignal
      })

      reader = response.body?.getReader()

      if (response.status === 401) {
        throw githubError(401, "Reconnect GitHub to download repository files", "GITHUB_RECONNECT")
      }

      if (response.status === 403 || response.status === 429) {
        throw githubError(503, "GitHub denied access or temporarily limited file downloads")
      }

      if (response.status === 404) {
        throw githubError(404, "A repository file is no longer accessible")
      }

      if (!response.ok || !reader) {
        throw githubError(502, "Could not download a repository file")
      }

      const chunks = []
      let size = 0

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          finished = true
          break
        }

        accountBytes(value.byteLength)
        size += value.byteLength

        if (size > repositoryLimits.maxFileBytes || size > file.size) {
          throw githubError(422, "Downloaded file exceeds its allowed size")
        }

        chunks.push(Buffer.from(value))
      }

      if (size !== file.size) {
        throw githubError(502, "Downloaded file size does not match the saved tree")
      }

      const content = Buffer.concat(chunks, size)
      const sha = createHash("sha1")
        .update(`blob ${size}\0`)
        .update(content)
        .digest("hex")

      if (sha !== file.sha.toLowerCase()) {
        throw githubError(502, "Downloaded file does not match its expected blob SHA")
      }

      return content
    } catch (error) {
      if (error.publicMessage) {
        throw error
      }

      if (requestSignal.aborted) {
        throw githubError(504, "Repository file download was cancelled or timed out")
      }

      throw githubError(502, "Could not download a repository file")
    } finally {
      if (reader) {
        if (!finished) {
          await reader.cancel().catch(() => {})
        }

        reader.releaseLock()
      }
    }
  }
}

module.exports = {
  exchangeCode,
  getProfile,
  getRepositories,
  getLatestCommit,
  getRepositoryTree,
  createRepositoryBlobReader,
  githubError
}
