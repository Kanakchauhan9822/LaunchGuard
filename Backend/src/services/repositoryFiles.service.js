const path = require("node:path")
const { repositoryLimits, ignoredDirectories, binaryExtensions } = require("../config/repository")

function selectionError(message) {
  return Object.assign(new Error(message), {
    status: 422,
    publicMessage: message,
    code: "REPOSITORY_SELECTION_FAILED"
  })
}

function isSafeRepositoryPath(filePath) {
  if (
    typeof filePath !== "string" ||
    !filePath ||
    filePath.length > 4096 ||
    /[\\\x00-\x1f\x7f:*?"<>|]/.test(filePath) ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath)
  ) {
    return false
  }

  return filePath.split("/").every(part => {
    return (
      part !== "" &&
      part !== "." &&
      part !== ".." &&
      !/[. ]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
  })
}

function selectRepositoryFiles(tree) {
  if (!Array.isArray(tree)) {
    throw selectionError("GitHub returned an invalid repository file list")
  }

  if (tree.length > repositoryLimits.maxTreeEntries) {
    throw selectionError(`Repository exceeds the ${repositoryLimits.maxTreeEntries} tree-entry limit`)
  }

  const files = []
  const skipped = []
  const seenPaths = new Set()
  let totalBytes = 0

  for (const entry of tree) {
    if (!entry || typeof entry.path !== "string") {
      throw selectionError("Repository contains an invalid file entry")
    }

    if (!isSafeRepositoryPath(entry.path)) {
      skipped.push({ path: entry.path, reason: "unsafe-or-unsupported-path" })
      continue
    }

    if (seenPaths.has(entry.path)) {
      throw selectionError("Repository file list contains duplicate paths")
    }

    seenPaths.add(entry.path)

    if (entry.type === "tree" && entry.mode === "040000") {
      continue
    }

    let reason
    const directories = entry.path.split("/").slice(0, -1)

    if (entry.mode === "120000") {
      reason = "symbolic-link"
    } else if (entry.type === "commit" || entry.mode === "160000") {
      reason = "submodule"
    } else if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      reason = "unsupported-entry-type"
    } else if (directories.some(directory => ignoredDirectories.has(directory))) {
      reason = "ignored-directory"
    } else if (binaryExtensions.has(path.posix.extname(entry.path).toLowerCase())) {
      reason = "binary-extension"
    }

    if (reason) {
      skipped.push({ path: entry.path, reason })
      continue
    }

    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha !== "string" ||
      !/^[a-f0-9]{40}$/i.test(entry.sha)
    ) {
      throw selectionError("Repository contains invalid file size or blob metadata")
    }

    if (entry.size > repositoryLimits.maxFileBytes) {
      skipped.push({ path: entry.path, reason: "file-size-limit", size: entry.size })
      continue
    }

    if (files.length >= repositoryLimits.maxFiles) {
      throw selectionError(`Repository exceeds the ${repositoryLimits.maxFiles} eligible-file limit`)
    }

    if (totalBytes + entry.size > repositoryLimits.maxTotalBytes) {
      throw selectionError("Selected repository files exceed the total download-size limit")
    }

    files.push({
      path: entry.path,
      sha: entry.sha,
      size: entry.size,
      mode: entry.mode
    })
    totalBytes += entry.size
  }

  files.sort((first, second) => {
    if (first.path < second.path) {
      return -1
    }

    if (first.path > second.path) {
      return 1
    }

    return 0
  })

  return {
    files,
    skipped,
    totalBytes,
    treeEntryCount: tree.length
  }
}

module.exports = {
  isSafeRepositoryPath,
  selectRepositoryFiles
}
