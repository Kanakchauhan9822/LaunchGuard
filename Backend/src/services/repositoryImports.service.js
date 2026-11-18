const { Linter } = require("eslint")
const path = require("node:path")
const { builtinModules } = require("node:module")
const { githubError } = require("./github.service")
const { isSafeRepositoryPath } = require("./repositoryFiles.service")

const linter = new Linter()

function getLocalImports(file, externalPackages = null) {
  const imports = new Set()

  function collect(source) {
    if (
      typeof source?.value !== "string" ||
      /^(?:@\/|~\/|#|\/)/.test(source.value)
    ) {
      throw githubError(422, "Some imports require project-specific resolution")
    }

    const value = source.value
    const packageName = value.startsWith("@") ? value.split("/").slice(0, 2).join("/") : value.split("/")[0]

    if (
      externalPackages &&
      !value.startsWith(".") &&
      !value.startsWith("node:") &&
      !builtinModules.includes(value) &&
      !externalPackages.has(packageName)
    ) {
      throw githubError(422, "An import may require a project-specific alias")
    }

    if (
      typeof source?.value === "string" &&
      (
        source.value.startsWith("./") ||
        source.value.startsWith("../") ||
        source.value === "." ||
        source.value === ".."
      )
    ) {
      imports.add(source.value)
    }
  }

  const messages = linter.verify(
    file.content,
    [
      {
        files: ["**/*"],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: file.path.endsWith(".cjs") ? "commonjs" : "module",
          parserOptions: {
            ecmaFeatures: {
              jsx: true
            }
          }
        },
        plugins: {
          launchguard: {
            rules: {
              imports: {
                create() {
                  return {
                    ImportDeclaration(node) {
                      collect(node.source)
                    },
                    ExportNamedDeclaration(node) {
                      if (node.source) {
                        collect(node.source)
                      }
                    },
                    ExportAllDeclaration(node) {
                      collect(node.source)
                    },
                    ImportExpression(node) {
                      collect(node.source)
                    },
                    CallExpression(node) {
                      if (
                        node.callee.type === "MemberExpression" &&
                        node.callee.object.name === "require" &&
                        (node.callee.computed || node.callee.property.name !== "resolve")
                      ) {
                        throw githubError(422, "Some imports require project-specific resolution")
                      }

                      if (
                        (node.callee.type === "Identifier" && node.callee.name === "require") ||
                        (node.callee.type === "MemberExpression" && node.callee.object.name === "require")
                      ) {
                        collect(node.arguments[0])
                      }

                      if (
                        node.callee.type === "MemberExpression" &&
                        node.callee.object.type === "MetaProperty"
                      ) {
                        throw githubError(422, "Some imports require project-specific resolution")
                      }
                    }
                  }
                }
              }
            }
          }
        },
        rules: {
          "launchguard/imports": "error"
        }
      }
    ],
    {
      filename: "source.js",
      allowInlineConfig: false
    }
  )

  if (messages.some(message => message.fatal)) {
    throw githubError(
      422,
      "Related JavaScript files could not be analyzed. Run an entire-project review"
    )
  }

  return [...imports]
}

function resolveLocalImport(filePath, specifier, paths) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier))

  if (!isSafeRepositoryPath(target)) {
    throw githubError(422, "A local import could not be resolved within the repository")
  }

  if (paths.has(target)) {
    return target
  }

  if (paths.has(`${target}/package.json`)) {
    throw githubError(422, "A local package requires project-specific resolution")
  }

  const candidates = [".js", ".jsx", ".mjs", ".cjs", ".json"]
    .flatMap(extension => [`${target}${extension}`, `${target}/index${extension}`])
    .filter(candidate => paths.has(candidate))

  if (candidates.length !== 1) {
    throw githubError(422, "A local import could not be resolved unambiguously")
  }

  return candidates[0]
}

function selectRelatedFiles(files, changedFiles, tree, signal) {
  const changedPaths = new Set(changedFiles.flatMap(file => [
    file.path,
    ...(file.previousPath ? [file.previousPath] : [])
  ]))
  const paths = new Set([
    ...tree.filter(entry => entry.type === "blob").map(entry => entry.path),
    ...changedPaths
  ])
  const selected = new Set(changedPaths)
  const externalPackages = new Set()

  if ([...changedPaths].some(filePath => !isSafeRepositoryPath(filePath))) {
    throw githubError(422, "Some changed paths need a full-project scan")
  }

  if (changedFiles.some(file => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|[^/]+\.config\.[cm]?js|[jt]sconfig[^/]*\.json|\.env[^/]*)$/.test(file.path))) {
    throw githubError(422, "Dependency or configuration changes need a full-project scan")
  }

  if (changedFiles.some(file => !/\.(js|jsx|mjs|cjs|json|css|scss|html|md|txt)$/.test(file.path))) {
    throw githubError(422, "Some changed files need a full-project scan")
  }

  for (const file of files) {
    if (path.posix.basename(file.path) === "package.json") {
      let manifest

      try {
        manifest = JSON.parse(file.content)
      } catch {
        throw githubError(422, "Package configuration could not be analyzed")
      }

      if (manifest?.workspaces || manifest?.imports) {
        throw githubError(422, "Workspace or package aliases need a full-project scan")
      }

      for (const name of [
        ...Object.keys(manifest?.dependencies || {}),
        ...Object.keys(manifest?.devDependencies || {}),
        ...Object.keys(manifest?.peerDependencies || {}),
        ...Object.keys(manifest?.optionalDependencies || {}),
        manifest?.name
      ]) {
        externalPackages.add(name)
      }
    }
  }

  for (const file of files) {
    signal?.throwIfAborted()

    if (/\.(ts|tsx|vue|svelte)$/.test(file.path)) {
      throw githubError(422, "Some source files need a full-project scan")
    }

    if (!/\.(js|jsx|mjs|cjs)$/.test(file.path)) {
      continue
    }

    const dependencies = getLocalImports(file, externalPackages).map(specifier => {
      return resolveLocalImport(file.path, specifier, paths)
    })

    if (changedPaths.has(file.path)) {
      for (const dependency of dependencies) {
        selected.add(dependency)
      }
    }

    if (dependencies.some(dependency => changedPaths.has(dependency))) {
      selected.add(file.path)
    }
  }

  const directories = new Set(["."])

  for (const filePath of selected) {
    let directory = path.posix.dirname(filePath)

    while (directory !== ".") {
      directories.add(directory)
      directory = path.posix.dirname(directory)
    }
  }

  return files.filter(file => {
    return selected.has(file.path) || (
      directories.has(path.posix.dirname(file.path)) &&
      /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path.posix.basename(file.path))
    )
  })
}

module.exports = {
  getLocalImports,
  selectRelatedFiles
}
