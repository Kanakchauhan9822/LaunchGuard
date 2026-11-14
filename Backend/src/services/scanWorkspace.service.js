const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { repositoryLimits } = require("../config/repository")
const { isSafeRepositoryPath } = require("./repositoryFiles.service")

async function withScanWorkspace(files, operation, signal) {
  signal?.throwIfAborted()

  if (typeof operation !== "function") {
    throw workspaceError("A scan operation is required")
  }

  const selected = validateFiles(files)
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const workspace = await fs.mkdtemp(path.join(temporaryRoot, "launchguard-scan-"))

  try {
    await fs.chmod(workspace, 0o700)
    const sourceDirectory = path.join(workspace, "source")
    await fs.mkdir(sourceDirectory, { mode: 0o700 })

    for (const file of selected) {
      signal?.throwIfAborted()
      const destination = path.resolve(sourceDirectory, ...file.path.split("/"))
      assertContained(sourceDirectory, destination)

      await fs.mkdir(path.dirname(destination), {
        recursive: true,
        mode: 0o700
      })

      await fs.writeFile(destination, file.content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
        signal
      })
    }

    signal?.throwIfAborted()
    const result = await operation({ workspace, sourceDirectory, signal })
    signal?.throwIfAborted()
    return result
  } finally {
    await removeWorkspace(temporaryRoot, workspace)
  }
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length > repositoryLimits.maxFiles) {
    throw workspaceError("Invalid scan file list or file-count limit exceeded")
  }

  const entries = new Map()
  const selected = []
  let totalBytes = 0

  for (const file of files) {
    if (
      !file ||
      !isSafeRepositoryPath(file.path) ||
      typeof file.content !== "string" ||
      !["100644", "100755"].includes(file.mode)
    ) {
      throw workspaceError("Scan files contain an unsupported path, content or file type")
    }

    const bytes = Buffer.byteLength(file.content, "utf8")
    totalBytes += bytes

    if (
      bytes > repositoryLimits.maxFileBytes ||
      totalBytes > repositoryLimits.maxTotalBytes
    ) {
      throw workspaceError("Scan workspace exceeds the file or total byte limit")
    }

    const parts = file.path.split("/")

    for (let index = 0; index < parts.length; index++) {
      const originalPath = parts.slice(0, index + 1).join("/")
      const key = originalPath.normalize("NFC").toLowerCase()
      const type = index === parts.length - 1 ? "file" : "directory"
      const existing = entries.get(key)

      if (
        existing &&
        (
          existing.path !== originalPath ||
          existing.type !== type ||
          type === "file"
        )
      ) {
        throw workspaceError("Scan files contain duplicate or conflicting paths")
      }

      entries.set(key, {
        path: originalPath,
        type
      })
    }

    selected.push({
      path: file.path,
      content: file.content
    })
  }

  return selected
}

function assertContained(parent, target) {
  const relative = path.relative(parent, target)

  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw workspaceError("Scan workspace path is outside its allowed directory")
  }
}

async function removeWorkspace(temporaryRoot, workspace) {
  const resolved = path.resolve(workspace)
  assertContained(temporaryRoot, resolved)

  if (
    path.dirname(resolved) !== temporaryRoot ||
    !path.basename(resolved).startsWith("launchguard-scan-")
  ) {
    throw workspaceError("Refusing to remove an unexpected scan directory")
  }

  let metadata

  try {
    metadata = await fs.lstat(resolved)
  } catch (error) {
    if (error.code === "ENOENT") {
      return
    }

    throw error
  }

  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    await fs.realpath(resolved) !== resolved
  ) {
    throw workspaceError("Refusing to remove a replaced scan directory")
  }

  await fs.rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100
  })
}

function workspaceError(message) {
  return Object.assign(new Error(message), {
    status: 422,
    publicMessage: message,
    code: "SCAN_WORKSPACE_FAILED"
  })
}

module.exports = {
  withScanWorkspace
}
