const { aiConfig } = require("../config/ai")
const { scanWithGitleaks } = require("./gitleaks.service")

async function selectImprovementFiles(files, signal) {
  signal?.throwIfAborted()

  const preferredFolders = /(^|\/)(controllers|services|components|hooks)\//
  const candidates = files
    .filter(file => /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file.path))
    .sort((first, second) => {
      const priority = Number(preferredFolders.test(second.path))
        - Number(preferredFolders.test(first.path))

      return priority || first.path.localeCompare(second.path)
    })

  const selected = []
  let characters = 0

  for (const file of candidates) {
    if (selected.length >= aiConfig.maxImprovementFiles) {
      break
    }

    if (
      !file.content.trim() ||
      characters + file.content.length > aiConfig.maxImprovementCharacters
    ) {
      continue
    }

    selected.push(file)
    characters += file.content.length
  }

  if (selected.length === 0) {
    return []
  }

  const secretScan = await scanWithGitleaks(selected, signal)

  if (secretScan.outcome.status !== "completed") {
    throw new Error("Could not check the selected files for secrets")
  }

  const excludedPaths = new Set(
    secretScan.findings.map(finding => finding.filePath)
  )

  return selected
    .filter(file => !excludedPaths.has(file.path))
    .map(file => ({
      path: file.path,
      content: file.content
    }))
}

module.exports = {
  selectImprovementFiles
}
