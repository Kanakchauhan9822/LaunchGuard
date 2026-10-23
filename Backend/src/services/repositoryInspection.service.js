const path = require("node:path")
const { ignoredDirectories } = require("../config/repository")
const { isSafeRepositoryPath } = require("./repositoryFiles.service")

const lockfileManagers = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"]
])

const knownTechnologies = new Map([
  ["react", { name: "React", category: "ui-library" }],
  ["next", { name: "Next.js", category: "framework" }],
  ["express", { name: "Express", category: "framework" }],
  ["mongoose", { name: "Mongoose", category: "database-library" }],
  ["redis", { name: "Node Redis", category: "redis-client" }],
  ["ioredis", { name: "ioredis", category: "redis-client" }],
  ["@upstash/redis", { name: "Upstash Redis", category: "redis-client" }],
  ["ws", { name: "ws", category: "websocket-library" }],
  ["websocket", { name: "WebSocket", category: "websocket-library" }],
  ["socket.io", { name: "Socket.IO Server", category: "realtime-library" }],
  ["socket.io-client", { name: "Socket.IO Client", category: "realtime-library" }],
  ["bullmq", { name: "BullMQ", category: "job-queue" }],
  ["bull", { name: "Bull", category: "job-queue" }],
  ["vue", { name: "Vue", category: "framework" }],
  ["@angular/core", { name: "Angular", category: "framework" }],
  ["@nestjs/core", { name: "NestJS", category: "framework" }],
  ["fastify", { name: "Fastify", category: "framework" }],
  ["vite", { name: "Vite", category: "build-tool" }]
])

function inspectRepository(files, tree) {
  const packages = []
  const warnings = []
  const packageManagers = inspectPackageManagers(tree, warnings)

  for (const file of files) {
    if (path.posix.basename(file.path) !== "package.json") {
      continue
    }

    let manifest

    try {
      manifest = JSON.parse(file.content)
    } catch {
      warnings.push({
        path: file.path,
        reason: "invalid-package-json"
      })

      continue
    }

    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest)
    ) {
      warnings.push({
        path: file.path,
        reason: "invalid-package-manifest"
      })

      continue
    }

    const { dependencies, technologies } = inspectDependencies(manifest, file.path, warnings)

    packages.push({
      path: file.path,
      directory: path.posix.dirname(file.path),
      name: typeof manifest.name === "string" ? manifest.name : null,
      dependencies,
      technologies
    })
  }

  return {
    packages,
    packageManagers,
    warnings
  }
}

function inspectDependencies(manifest, manifestPath, warnings) {
  const dependencies = []
  const technologies = []

  for (const section of ["dependencies", "devDependencies"]) {
    if (!Object.hasOwn(manifest, section)) {
      continue
    }

    const declarations = manifest[section]

    if (
      !declarations ||
      typeof declarations !== "object" ||
      Array.isArray(declarations)
    ) {
      warnings.push({
        path: manifestPath,
        section,
        reason: "invalid-dependency-section"
      })

      continue
    }

    for (const [name, version] of Object.entries(declarations)) {
      if (
        !name.trim() ||
        typeof version !== "string" ||
        !version.trim()
      ) {
        warnings.push({
          path: manifestPath,
          section,
          name,
          reason: "invalid-dependency-declaration"
        })

        continue
      }

      dependencies.push({
        name,
        version,
        section,
        path: manifestPath
      })

      const technology = knownTechnologies.get(name)

      if (technology) {
        technologies.push({
          name: technology.name,
          category: technology.category,
          dependency: name,
          version,
          section,
          path: manifestPath,
          evidence: "declared-dependency"
        })
      }
    }
  }

  return {
    dependencies,
    technologies
  }
}

function inspectPackageManagers(tree, warnings) {
  const packageManagers = []
  const directories = new Map()
  const seenPaths = new Set()

  for (const entry of tree) {
    if (
      !entry ||
      !isSafeRepositoryPath(entry.path) ||
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode) ||
      seenPaths.has(entry.path)
    ) {
      continue
    }

    const parents = entry.path.split("/").slice(0, -1)

    if (parents.some(directory => ignoredDirectories.has(directory))) {
      continue
    }

    const manager = lockfileManagers.get(path.posix.basename(entry.path))

    if (!manager) {
      continue
    }

    seenPaths.add(entry.path)
    const directory = path.posix.dirname(entry.path)
    const declaration = {
      manager,
      path: entry.path,
      directory,
      evidence: "lockfile-presence"
    }

    packageManagers.push(declaration)

    if (!directories.has(directory)) {
      directories.set(directory, [])
    }

    directories.get(directory).push(declaration)
  }

  for (const [directory, declarations] of directories) {
    const managers = [...new Set(declarations.map(entry => entry.manager))]

    if (managers.length > 1) {
      warnings.push({
        directory,
        managers,
        paths: declarations.map(entry => entry.path),
        reason: "conflicting-package-manager-lockfiles"
      })
    }
  }

  return packageManagers
}



module.exports = {
  inspectRepository
}
