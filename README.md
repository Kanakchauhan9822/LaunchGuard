# LaunchGuard AI

**Understand the project. Test the code. Explain what needs fixing.**

LaunchGuard AI is a planned, GitHub-connected platform for **on-demand code auditing and intelligent testing** of web applications, including projects that are still being built. It aims to discover relevant application behavior, check code for bugs and vulnerabilities, produce evidence-backed findings, and suggest improvements in clear language.

> **Project status: Planning / architecture finalized.** The features and commands described as planned below are **not yet implemented or verified**. This README will be updated as real development progresses.

## The Problem

Developers, including people building websites with AI coding assistants, can end up with applications that look correct but contain security gaps, broken workflows, incorrect validations, weak error handling or unsafe dependencies. Generic AI reviews can also invent problems because they do not understand the project's intended behavior.

LaunchGuard aims to combine established scanners, application-aware AI reasoning, and reproducible tests so that reviews provide **evidence**, not just an AI opinion.

## How It Will Work

1. Connect a GitHub repository through a read-only GitHub App integration.
2. Give a short description of what the application is supposed to do (first-time setup).
3. Work normally and push code to GitHub. **A push does not start a scan.**
4. Whenever you choose, click **Review Latest Changes** or **Review Entire Project**.
5. LaunchGuard analyzes the selected commit, understands currently implemented functionality and plans relevant checks.
6. Available static scanners run; supported tests are generated and executed **only where appropriate and safely authorized**.
7. Review an audit report containing affected files, observed behavior, expected behavior, confidence/verification status, severity and recommended fixes.

LaunchGuard requests clarification only when an important requirement cannot reliably be inferred. Such questions will offer clear options plus an **Other / Describe it yourself** choice. No manual approval of each test or finding is required.

## Planned Core Features

- **GitHub-based, on-demand reviews:** Explicit review button; no automatic monitoring or scanning on pushes.
- **Project Understanding Engine:** Uses user description, documentation, code, UI, routes, models and tests to infer functionality and requirements.
- **Development-aware audits:** Tests features that exist; does not classify every unfinished feature as a bug.
- **Static security and quality checks:** Known insecure patterns, probable exposed secrets, dependency advisories and JavaScript/React quality checks.
- **Context-aware AI explanations:** Explains technical findings in approachable language, with evidence and proposed fixes.
- **Evidence-first reports:** Separates verified failures, scanner findings, AI hypotheses, inconclusive tests and skipped checks.
- **Commit comparisons:** Show new, resolved and outstanding findings relative to previous requested reviews.
- **Reliable background work:** Redis/BullMQ queues, isolated worker responsibilities, bounded retries and durable history.
- **Later: generated tests and fix verification:** Controlled unit/integration/browser tests and suggested code changes, only after safe execution infrastructure is available.

## Planned Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React, JavaScript, Vite | Dashboard and audit reports |
| Backend | Node.js, Express | Auth, GitHub integration, review APIs |
| Database | MongoDB, Mongoose | Project knowledge, review history, findings |
| Background processing | Redis, BullMQ | Scan queues, retries, coordination, caching |
| Real-time progress | Socket.io | Notify dashboard of review progress |
| Repository integration | GitHub App, Octokit, Git | Authorized read-only repository access |
| AI | Gemini or OpenAI API | Project understanding, test planning, explanations |
| Static analysis | Semgrep, Gitleaks, OSV-Scanner, ESLint | Evidence-based vulnerability and quality checks |
| Later testing | Vitest, Playwright | Unit/integration/browser verification when safely runnable |
| Containers | Docker, Docker Compose | Reproducible services and independent workers |

The application backend is JavaScript-based. **No PostgreSQL, Prisma, Nginx, or Kubernetes is planned.** Scanner tools may use their own native runtimes.

## Planned Architecture

```text
React Dashboard
      |
      v
Node.js / Express API  --  GitHub App (read-only repository access)
      |
      v
MongoDB: durable review request
      |
      v
Redis + BullMQ: background jobs
      |
      +--> Repository analysis / project understanding
      +--> Security, secrets, dependency and quality scanners
      +--> AI interpretation and test planning
      +--> Later: authorized, hardened test execution
      |
      v
MongoDB: findings + review report
      |
      v
Socket.io status / React dashboard
```

Review jobs are tied to a **specific Git commit SHA**, so a newer push does not change an already-running review. Scanner results are kept even if AI analysis or another check fails; incomplete coverage will be reported accurately.

## Docker: Multi-Service Architecture (Planned)

Unlike PeerSpace's earlier single-container setup, LaunchGuard is designed around separate roles for the Express API, scan workers, Redis and MongoDB, with the React frontend served appropriately for the chosen environment.

Docker Compose is the intended local orchestration tool. It will allow independently running/scaling worker processes without adding Nginx. Exact Compose commands, images, ports, health checks and volumes will be documented **after these services are created and tested**.

No container, cloud account, database, or AI provider resource is created merely by this README.

## Environment (To Be Finalized During Implementation)

Expected categories of configuration include:

- MongoDB connection configuration
- Redis connection configuration
- GitHub App ID, installation authentication and private key (server-side only)
- Session/JWT signing secrets, depending on final auth approach
- Gemini/OpenAI credentials and usage budgets
- Permitted frontend origin and backend port
- Scan concurrency, timeouts and repository-size limits

A real `.env.example` will be added when the corresponding code is introduced. Secrets must be supplied at runtime, kept out of Git and Docker build contexts, and never sent to browsers or third-party AI analysis without authorization.

## Local Development Without Docker (Planned)

Use separate backend and frontend development processes following the patterns adopted from the `teacherDemo` reference. API routes and dependencies will be added feature by feature; concrete `npm` commands will be documented after each package has scripts and working configuration.

A sibling `teacherDemo/` folder may be included in a VS Code multi-root workspace as **read-only reference material**. It is not a dependency of LaunchGuard and must not be modified or published with this project.

## Checks (To Be Added as Features Are Implemented)

Planned verification includes:

- Express route and service tests for success, validation, authentication and error cases
- GitHub installation/repository permission tests
- Queue retry, duplicate job, stalled worker and durable-request recovery tests
- Scanner adapter contract tests and normalized findings tests
- AI output schema and sanitization tests
- React lint/build and frontend/API integration tests
- Later, trusted/hardened Vitest and Playwright execution tests
- Docker health checks and graceful shutdown verification

Do not treat a test as passed until it has actually been executed. Exact test commands and status will be recorded as functionality is implemented.

## Security and Test-Execution Boundaries

- GitHub repository access will be **read-only** for the initial version and limited to selected repositories.
- Repository files are **untrusted input**. Initial scans will avoid executing arbitrary project commands or dependency lifecycle scripts.
- Docker containers alone are not a complete security boundary for running arbitrary third-party code. Public execution of untrusted tests requires additional hardened isolation and resource controls.
- Detect and redact credentials before AI analysis. Never reveal a detected secret's full value.
- Keep project data and caches scoped per authorized user/project.
- Repository text or prompts embedded in source files must not control LaunchGuard's instructions or access policy.
- A passing generated test is not proof that an application has no bugs, and a speculative AI observation is not a confirmed vulnerability.
- Suggested fixes do not automatically change a connected GitHub repository.

## Hosting and Future Scaling

Start with one modular Express backend and separately runnable background workers. Scale worker instances based on queue load, and later scale API instances without relying on local in-memory review state.

MongoDB is the durable source for review requests and reports; Redis coordinates processing. Idempotent jobs, bounded retries, partial reports, request recovery and exact-commit pinning are architecture requirements from the start.

Docker Compose on a single host is **not** high availability. Multiple hosts, redundant databases or managed infrastructure may be considered later when real usage justifies them. No Nginx or Kubernetes is required for the first version.

## Development Roadmap

1. Inspect teacherDemo conventions; establish repo, local AI guidance and minimal React/Express foundations.
2. Implement authentication, project creation, GitHub App connection and read-only repository selection.
3. Add explicit review creation, exact SHA selection, MongoDB review lifecycle and Redis/BullMQ worker processing.
4. Detect project frameworks/features and run Semgrep, Gitleaks, OSV-Scanner and applicable ESLint checks.
5. Normalize findings, store evidence, add AI explanations and build the report dashboard.
6. Add review comparison, crash/retry tests, operational metrics and Docker service health checks.
7. After security design, add AI-generated tests, authorized execution, targeted fix validation and broader framework coverage.

Develop incrementally using **Need → Create → Implement → Connect → Use → Test → Next**. A feature is not considered complete until the relevant end-to-end flow is connected and tested.

## Status

**Planning complete; implementation not yet verified or started.** This file intentionally avoids fictional setup results, benchmark claims and feature-completion statements. Update the README to reflect working commands and demonstrated capabilities as the project progresses.
