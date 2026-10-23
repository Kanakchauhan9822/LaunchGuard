const { TextDecoder } = require("node:util")
const { repositoryLimits } = require("../config/repository")
const { githubError } = require("./github.service")

async function downloadRepositoryFiles(selection, readBlob, signal) {
  const controller = new AbortController()
  const signals = [controller.signal, AbortSignal.timeout(repositoryLimits.downloadTimeoutMs)]

  if (signal) {
    signals.push(signal)
  }

  const downloadSignal = AbortSignal.any(signals)
  const results = new Array(selection.files.length)
  let nextIndex = 0
  let downloadedBytes = 0
  let firstError

  function accountBytes(size) {
    downloadedBytes += size

    if (downloadedBytes > repositoryLimits.maxTotalBytes) {
      throw githubError(422, "Repository download exceeds the total byte limit")
    }
  }

  async function downloadNext() {
    try {
      while (nextIndex < selection.files.length) {
        downloadSignal.throwIfAborted()
        const index = nextIndex++
        const file = selection.files[index]
        const content = await readBlob(file, downloadSignal, accountBytes)

        if (content.includes(0)) {
          results[index] = {
            skipped: {
              path: file.path,
              reason: "binary-content"
            }
          }
          continue
        }

        let text

        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(content)
        } catch {
          results[index] = {
            skipped: {
              path: file.path,
              reason: "unsupported-text-encoding"
            }
          }
          continue
        }

        if (/[\x01-\x08\x0e-\x1f\x7f]/.test(text)) {
          results[index] = {
            skipped: {
              path: file.path,
              reason: "binary-content"
            }
          }
          continue
        }

        if (
          text.startsWith("version https://git-lfs.github.com/spec/v1\n") ||
          text.startsWith("version https://git-lfs.github.com/spec/v1\r\n")
        ) {
          results[index] = {
            skipped: {
              path: file.path,
              reason: "git-lfs-pointer"
            }
          }
          continue
        }

        results[index] = {
          file: {
            ...file,
            content: text
          }
        }
      }
    } catch (error) {
      if (!firstError) {
        firstError = error.publicMessage
          ? error
          : githubError(504, "Repository download was cancelled or timed out")
      }

      controller.abort()
    }
  }

  if (downloadSignal.aborted) {
    throw githubError(504, "Repository download was cancelled")
  }

  const workers = Array.from(
    { length: Math.min(repositoryLimits.downloadConcurrency, selection.files.length) },
    () => downloadNext()
  )

  await Promise.all(workers)

  if (firstError) {
    throw firstError
  }

  const files = []
  const skipped = [...selection.skipped]

  for (const result of results) {
    if (result.file) {
      files.push(result.file)
    } else {
      skipped.push(result.skipped)
    }
  }

  return {
    files,
    skipped,
    downloadedBytes,
    selectedBytes: selection.totalBytes,
    treeEntryCount: selection.treeEntryCount
  }
}

module.exports = {
  downloadRepositoryFiles
}
