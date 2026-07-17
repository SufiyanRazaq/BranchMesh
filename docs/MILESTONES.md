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

## Milestone 1 — Complete: End-to-end vertical slice

Deliverables:

- Resolve a base and two immutable branch commits.
- Create owned detached temporary worktrees.
- Prove both branches pass individually and fail behaviorally as a pair.
- Run one configured command, write validated JSON, and clean up every worktree.

Acceptance gate:

- The deterministic demo proves A pass, B pass, and A+B behavioral conflict.
- The scanned repository's HEAD, index, status, refs, and existing worktrees are unchanged.
- Typecheck, tests, build, and the demo pass.

Completed on 2026-07-17. The fixed serial path validates the snapshotted base, each of two
branches, and their canonical pair in separate owned worktrees. The real demo scan exits `1` for
the expected incompatibility; `npm run demo:verify` exits `0` only after validating
`BEHAVIORAL_CONFLICT`, `PAIR_TEST_FAILURE`, no textual conflict, unchanged repository state, and
zero remaining temporary worktrees.

Historical Milestone 1 boundary (superseded by the Milestone 2 implementation below):

- The implementation accepts exactly two branches and one validation command.
- It is deliberately serial and is not the complete scanner or CLI suite.
- Timeouts, full preflight, bounded concurrency, durable logs, recovery, and HTML remain in later
  milestones.

## Milestone 2 — Complete: Deterministic scanning engine

Deliverables:

- Full preflight and immutable run snapshot.
- Base, all individual branches, and every eligible canonical pair.
- Dirty-state rejection, timeout, cancellation, bounded concurrency, logs, and classifications.
- Every ineligible planned pair represented as `PAIR_SKIPPED`.

Acceptance gate:

- Deterministic complete result graph and correct exit codes for every supported outcome.
- No UI assumptions inside engine, Git, or classification modules.

Completed and accepted on 2026-07-17. Implementation evidence:

- Preflight validates Node.js 20+, Git 2.31+, supported platforms, canonical repository and common
  Git-directory identity, porcelain-`-z` worktrees, selected-worktree dirt, temporary storage,
  immutable refs, changed files, and unsupported submodule or Git LFS trees.
- The strict configuration contract defaults to five branches and concurrency two. The planner
  stores branches and every unique pair in canonical reference order.
- Base, branch, and eligible pair jobs run setup plus validation commands sequentially in fresh
  owned worktrees. Commands stop after their first failure; logs are bounded; timeouts and root
  cancellation terminate process groups before cleanup.
- Every ineligible pair is retained as `PAIR_SKIPPED`. Pair command failures use
  `BEHAVIORAL_CONFLICT` with a matching technical classification.
- The serial implementation passed its cleanup gate before bounded concurrency was enabled.
  Concurrent results are assembled by plan index, so completion timing cannot reorder output.
- JSON is Zod-validated before atomic publication outside every discovered repository worktree.
  Success, incompatibility, invalid-base, timeout, cancellation, report-publication, and partial
  cleanup paths are covered by tests that verify no BranchMesh worktree registration remains.
- The three-branch demo emits three branch jobs and three pair results. Its expected A+B
  behavioral incompatibility produces scan exit `1`, while the verification harness exits `0`.

Milestone boundary:

- This milestone exposes the complete engine through the existing deterministic demo surface;
  the full command suite remains Milestone 5.
- Durable raw-log layout and HTML are Milestone 4. Crash recovery and the complete adversarial Git
  matrix remain Milestone 3.
- The accepted implementation was committed as `c5cd4e6` with message
  `feat: add deterministic branch scanning engine`.

## Milestone 3 — Complete: Safety and correctness gate

Deliverables:

- Real temporary Git repository helpers and adversarial integration tests.
- Tests for behavioral and textual conflicts, invalid base, branch failure, timeout, dirt, paths
  with spaces, interruption, process descendants, hooks, signing, and every cleanup phase.

Acceptance gate:

- Original repositories and user worktrees remain unchanged.
- No BranchMesh worktree, child process, lock, or recoverable Git metadata remains after success or
  failure.

Completed and accepted on 2026-07-17. Implementation evidence:

- Added an ownership-marked temporary repository helper. Every adversarial test creates a fresh
  real Git repository beneath `os.tmpdir()` and deletes only its verified fixture root.
- Repository snapshots compare the original branch, HEAD, raw index bytes, all refs, porcelain
  status, tracked and untracked file contents, worktree registrations, and Git worktree
  administrative entries before and after execution.
- Covered no conflict, behavioral and textual conflicts, invalid base, individual failures and
  skipped pairs, every configured command kind, setup failure, timeout, missing executable, and
  pre-execution infrastructure failure with schema-validated results.
- Covered dirty selected worktrees, spaces and non-ASCII paths, hostile branch names, a ref moving
  after snapshot, existing user worktrees, disabled hooks and signing, and independence from global
  Git identity.
- Covered repeated interruption, child and grandchild termination, and cleanup after merge,
  command, timeout, cancellation, and result-publication failures.
- Covered lexical and symlink containment, missing, corrupt, and mismatched ownership metadata,
  idempotent cleanup, and the absence of orphaned worktrees or administrative records.
- A regression first demonstrated that ownership marker and manifest symlinks were accepted. The
  ownership reader now requires regular files and opens them with `O_NOFOLLOW` before any cleanup.
- Two consecutive complete Vitest runs passed with 75 tests across 20 files.

Milestone boundary:

- No report UI, new CLI commands, Codex skill, caching, or other product-output functionality was
  added.
- The accepted implementation was committed as `d30f153` with message
  `test: add adversarial Git safety coverage`.

## Milestone 4 — Implemented; acceptance pending: Product output

Deliverables:

- Terminal progress and summary.
- Atomic persistent JSON and log layout outside the scanned repository.
- Accessible offline HTML matrix and pair evidence drawer.

Acceptance gate:

- A new user can understand the hidden conflict without reading raw logs.
- The report remains functional with networking disabled and uses no external assets.

Implementation evidence on 2026-07-17:

- Added structured scan progress events and a Picocolors terminal renderer with explicit text
  labels for base, branch, and pair states; a compact compatibility matrix; summary counts; and
  JSON, HTML, and log locations. Machine-readable demo output remains progress-free.
- Default storage uses the locked repository-fingerprint/run-ID hierarchy and refreshes
  `latest/result.json` and `latest/report.html`. Explicit output remains the exact external
  directory requested by the caller.
- Command output is retained separately up to 5 MB per stream and command, staged in an
  ownership-marked directory beneath `os.tmpdir()`, stripped of ANSI controls, redacted, and then
  published under run-relative `logs/` paths. Every destination file is completed before an
  atomic link or rename makes it visible.
- Persistent `result.json` is Zod-validated with repository roots and selected worktree paths
  removed. The HTML embeds a second, stricter Zod-validated projection that omits all repository
  and worktree path fields and redacts environment values from commands and evidence.
- Added a framework-free, self-contained report with summary cards, an accessible matrix, branch
  snapshots, evidence drawer, classifications, commands, durations, exit details, bounded stdout
  and stderr, reproduction steps, full captured SHAs, limitations, responsive layout, and print
  styles.
- HTML and JSON serialization tests cover hostile tags including `</script>`, attributes, Unicode,
  ANSI control sequences, environment values, and local paths. The report CSP disables all
  connections and external resources; the implementation contains no fetch or runtime request.
- A regression first proved that an otherwise valid long command ID could exceed filesystem
  filename limits. Log filenames now preserve ordinary IDs and use a bounded prefix plus stable
  digest for long IDs without changing the configured ID or scan semantics.
- A publication-race regression proved that recursive rollback could remove a foreign file added
  after BranchMesh created a new output directory. Rollback now removes only exact files it
  published and then removes only empty directories.
- The complete suite passes with 87 tests across 24 files. The real demo verification observes
  three passing branches, one `BEHAVIORAL_CONFLICT` with `PAIR_TEST_FAILURE`, two
  `NO_DETECTED_CONFLICT` pairs, validated offline HTML, 14 separate log files, unchanged project
  state, and no remaining temporary worktree or report-staging directory.

Milestone boundary:

- The current deterministic `demo` command is the only CLI surface wired to these output modules;
  `scan`, `init`, `doctor`, `clean`, and the rest of CLI completeness remain Milestone 5.
- No Codex skill, caching, hosted assets, backend, runtime network call, merge-order testing, or
  higher-order combination was added.
- Milestone 4 remains awaiting human acceptance and has not been committed.

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
