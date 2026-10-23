const Project = require("../models/project.model")
const User = require("../models/user.model")
const { getRepositories, getRepositoryTree, createRepositoryBlobReader, githubError } = require("./github.service")
const { selectRepositoryFiles } = require("./repositoryFiles.service")
const { downloadRepositoryFiles } = require("./repositoryDownload.service")
const { inspectRepository } = require("./repositoryInspection.service")

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

    return {
        userId,
        sessionId,
        repository,
        commitSha: review.commitSha,
        tree,
        selection: selectRepositoryFiles(tree)
    }
}

async function getReviewFileTree(review) {
    const prepared = await prepareReviewRepository(review)

    return {
        repository: prepared.repository,
        commitSha: prepared.commitSha,
        tree: prepared.tree,
        selection: prepared.selection
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
    await onStage("inspecting-repository")
    const inspection = inspectRepository(source.files, prepared.tree)

    return {
        repository: prepared.repository,
        commitSha: prepared.commitSha,
        ...source,
        inspection
    }
}


module.exports = {
    getReviewRepository,
    getReviewFileTree,
    getReviewSource
}
