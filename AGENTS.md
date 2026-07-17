# BranchMesh Engineering Rules

## Sources of truth

1. Explicit user decisions in the active development thread.
2. `DECISIONS.md` for accepted product and architecture decisions.
3. `docs/BRANCHMESH_PRODUCT_PLAN.md` for the complete product plan.
4. `docs/CODEX_DEVELOPMENT_WORKFLOW.md` for development-process guidance only.

When these sources conflict, use the higher-priority source.

## Product contract

BranchMesh is a deterministic, local-first TypeScript CLI and Codex skill that tests whether
committed Git branches pass independently but fail when combined. It reports only evidence
observed through configured commands and must use the phrase “No detected conflict,” never
“Guaranteed safe.”

## Non-negotiable safety rules

- Never modify the scanned worktree, its index, HEAD, refs, or tracked or untracked files.
- Never run checkout, switch, reset, clean, stash, merge, or rebase in a user worktree.
- Run every synthetic merge and project command in a BranchMesh-owned detached worktree beneath
  `os.tmpdir()`.
- Store persistent scan artifacts outside the scanned repository in a BranchMesh-owned user-data
  directory, unless the user supplies an explicit `--output` path.
- `branchmesh init` is the only command allowed to create `branchmesh.config.json` in the current
  repository, and it must not overwrite the file without `--force`.
- Snapshot the base and every selected branch to immutable commit object IDs before scheduling
  jobs. Never execute a job against a moving branch ref.
- Reject dirty selected worktrees by default. An ignore-dirty option scans the captured commit; it
  never includes uncommitted content.
- Never delete a path unless BranchMesh created it and validates canonical containment, ownership
  metadata, run membership, repository identity, and applicable Git worktree membership.
- Do not use unscoped `git worktree prune` or delete arbitrary Git administrative metadata.
- Cleanup must be idempotent and tested after success, failure, timeout, exception, and signal.
- Add a regression test for every bug fix.

## Command execution rules

- Internal Git and operating-system commands use `spawn` or `execFile`, argument arrays,
  `shell: false`, and an explicit working directory.
- User-configured setup and validation commands are the only permitted `shell: true` boundary.
- Pass a configured command string unchanged. Never concatenate branch refs, paths, environment
  values, or other dynamic data into it.
- Never persist configured environment values in JSON, HTML, logs, or terminal diagnostics.
- Terminate and await complete process trees before removing their worktrees.

## MVP boundaries

- Node.js 20+, TypeScript, npm, Commander, Zod, Picocolors, tsup, and Vitest.
- One package; no monorepo.
- Pairwise combinations only, with five selected branches by default.
- `failFast` is false. Pairs containing a non-passing individual branch are `PAIR_SKIPPED`.
- Stop normal scanning after an invalid base. Do not implement continue-on-base-failure.
- Official platforms are macOS, Linux, and WSL. Reject native Windows, Git LFS, and submodules for
  the MVP.
- No backend, database, account system, telemetry, runtime HTTP calls, GitHub API integration,
  automatic pull-request integration, runtime model calls, or frontend framework.
- Do not add features outside the currently approved milestone.

## Architecture boundaries

- `src/git` owns Git inspection and internal Git execution.
- `src/engine` owns planning, job execution, classification, cancellation, and cleanup.
- `src/report` owns validated JSON persistence and offline report generation only.
- CLI command modules orchestrate services and contain minimal business logic.
- Report generation never imports or executes Git or engine code.
- Zod schemas are the runtime source of truth for configuration and result contracts.
- Do not add a production dependency without documenting its purpose.

## Development conduct

- Do not use subagents during implementation unless the user explicitly requests them.
- Do not commit, push, publish, tag, or open a pull request without explicit user approval.
- Preserve unrelated user changes and inspect the working tree before making edits.
- Keep implementation limited to the active milestone and avoid speculative abstractions.
- Record accepted product decisions in `DECISIONS.md` and material Codex work in
  `CODEX_BUILD_LOG.md`.

## Required verification

Before declaring repository work complete, run the checks applicable to the milestone:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Git-engine changes additionally require the relevant real-repository integration, safety, and
cleanup tests. Do not claim success when a required check has not run or has failed.
