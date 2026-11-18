const Project = require("../models/project.model")
const User = require("../models/user.model")
const { getRepositories, getRepositoryTree, getChangedFiles, createRepositoryBlobReader, githubError } = require("./github.service")
const { selectRepositoryFiles } = require("./repositoryFiles.service")
const { downloadRepositoryFiles } = require("./repositoryDownload.service")
const { inspectRepository } = require("./repositoryInspection.service")
const { selectRelatedFiles } = require("./repositoryImports.service")

async function getReviewRepository(review, signal) {
    const project = await Project.findOne({
        _id: review.project,
        owner: review.owner
    }).lean()

    if (!project) {
        throw githubError(404, "The project for this review no longer exists")
    }

    const user = await User.findById(review.owner)
        .select("_id +sessionId")
        .lean()

    if (!user || !user.sessionId) {
        throw githubError(
            401,
            "Please reconnect GitHub before processing this review",
            "GITHUB_RECONNECT"
        )
    }

    signal?.throwIfAborted()
    const repositories = await getRepositories(user._id, user.sessionId, signal)

    const repository = repositories.find(repository => {
        return (
            repository.id === project.repositoryId &&
            repository.installationId === project.installationId
        )
    })

    if (!repository) {
        throw githubError(
            403,
            "You no longer have access to this repository"
        )
    }

    return {
        repository,
        userId: user._id,
        sessionId: user.sessionId
    }
}

async function prepareReviewRepository(review, signal) {
    const { repository, userId, sessionId } = await getReviewRepository(review, signal)

    const tree = await getRepositoryTree(
        userId,
        sessionId,
        repository,
        review.commitSha,
        signal
    )

    let changedFiles = null
    let fallbackReason = null

    if (review.mode === "latest-changes") {
        try {
            changedFiles = await getChangedFiles(
                userId,
                sessionId,
                repository,
                review.baseCommitSha,
                review.commitSha,
                signal
            )
        } catch (error) {
            signal?.throwIfAborted()

            if (![409, 422].includes(error.status) || error.code === "GITHUB_RECONNECT") {
                throw error
            }

            fallbackReason = "The saved commits could not be fully compared. The entire project was scanned instead."
        }
    }

    return {
        userId,
        sessionId,
        repository,
        commitSha: review.commitSha,
        tree,
        changedFiles,
        fallbackReason,
        selection: selectRepositoryFiles(tree)
    }
}

async function getReviewSource(review, signal, onStage = async () => {}) {
    if (signal?.aborted) {
        throw githubError(504, "Repository retrieval was cancelled")
    }

    const prepared = await prepareReviewRepository(review, signal)

    if (signal?.aborted) {
        throw githubError(504, "Repository retrieval was cancelled")
    }

    await onStage("fetching-files")

    const readBlob = await createRepositoryBlobReader(
        prepared.userId,
        prepared.sessionId,
        prepared.repository
    )

    const source = await downloadRepositoryFiles(prepared.selection, readBlob, signal)
    signal?.throwIfAborted()
    let files = source.files
    let fallbackReason = prepared.fallbackReason

    if (review.mode === "latest-changes" && !fallbackReason) {
        try {
            if (source.skipped.some(file => /\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte)$/.test(file.path))) {
                throw new Error("Some source files could not be inspected")
            }

            files = selectRelatedFiles(source.files, prepared.changedFiles, prepared.tree, signal)
        } catch {
            signal?.throwIfAborted()
            fallbackReason = "Related files could not be mapped reliably. The entire project was scanned instead."
        }
    }

    await onStage("inspecting-repository")
    const inspection = inspectRepository(source.files, prepared.tree)

    return {
        repository: prepared.repository,
        commitSha: prepared.commitSha,
        changedFiles: prepared.changedFiles,
        ...source,
        files,
        allPaths: new Set(prepared.tree.filter(entry => entry.type === "blob").map(entry => entry.path)),
        scanScope: review.mode === "latest-changes" && !fallbackReason ? "changed-and-related" : "entire-project",
        fallbackReason,
        inspection
    }
}


module.exports = {
    getReviewRepository,
    getReviewSource,
    prepareReviewRepository
}
