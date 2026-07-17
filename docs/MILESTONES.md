# BranchMesh Milestones

Statuses are updated only after their acceptance gate has been verified. Starting a later
milestone requires explicit approval.

## Foundation — Complete

Deliverables:

- Governance and architecture documentation.
- Node.js 20+ TypeScript package using npm.
- Commander, Zod, Picocolors, tsup, Vitest, formatting, and linting.
- Strict TypeScript configuration.
- Initial source and test directory boundaries.
- Minimal placeholder CLI proving compilation.

Acceptance gate:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Completed on 2026-07-17. All foundation checks pass with no Milestone 1 implementation present.

## Milestone 1 — Not started: End-to-end vertical slice

Deliverables:

- Resolve a base and two immutable branch commits.
- Create owned detached temporary worktrees.
- Prove both branches pass individually and fail behaviorally as a pair.
- Run one configured command, write validated JSON, and clean up every worktree.

Acceptance gate:

- The deterministic demo proves A pass, B pass, and A+B behavioral conflict.
- The scanned repository's HEAD, index, status, refs, and existing worktrees are unchanged.
- Typecheck, tests, build, and the demo pass.

## Milestone 2 — Not started: Complete scanning engine

Deliverables:

- Full preflight and immutable run snapshot.
- Base, all individual branches, and every eligible canonical pair.
- Dirty-state rejection, timeout, cancellation, bounded concurrency, logs, and classifications.
- Every ineligible planned pair represented as `PAIR_SKIPPED`.

Acceptance gate:

- Deterministic complete result graph and correct exit codes for every supported outcome.
- No UI assumptions inside engine, Git, or classification modules.

## Milestone 3 — Not started: Safety and correctness gate

Deliverables:

- Real temporary Git repository helpers and adversarial integration tests.
- Tests for behavioral and textual conflicts, invalid base, branch failure, timeout, dirt, paths
  with spaces, interruption, process descendants, hooks, signing, and every cleanup phase.

Acceptance gate:

- Original repositories and user worktrees remain unchanged.
- No BranchMesh worktree, child process, lock, or recoverable Git metadata remains after success or
  failure.

## Milestone 4 — Not started: Product output

Deliverables:

- Terminal progress and summary.
- Atomic persistent JSON and log layout outside the scanned repository.
- Accessible offline HTML matrix and pair evidence drawer.

Acceptance gate:

- A new user can understand the hidden conflict without reading raw logs.
- The report remains functional with networking disabled and uses no external assets.

## Milestone 5 — Not started: CLI completeness

Deliverables:

- Complete `init`, `doctor`, `scan`, `demo`, `clean`, and `version` commands.
- Locked exit-code behavior and unsupported-environment diagnostics.

Acceptance gate:

- Every command observes its write and safety contract.
- `init` does not overwrite configuration without `--force`.

## Milestone 6 — Not started: Codex skill and documentation

Deliverables:

- Repository-scoped skill, workflow script, references, and metadata.
- README, architecture, safety, troubleshooting, and judge-testing documentation.

Acceptance gate:

- Codex can invoke BranchMesh, validate the result, explain evidence, and avoid absolute safety
  claims without modifying code unless asked.

## Milestone 7 — Not started: Release and submission verification

Deliverables:

- Prebuilt distribution, package archive, sample report, release verifier, screenshots, and
  submission documentation.

Acceptance gate:

- A fresh clone passes `npm ci`, `npm run verify`, and the deterministic demo.
- Supported-platform claims, offline behavior, links, licensing, and submission evidence are
  manually verified.
