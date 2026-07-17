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

## Milestone 4 — Complete and approved: Product output

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
  removed. The HTML embeds a second, stricter Zod-validated projection that omits those path fields
  and any environment map; evidence sanitization targets ANSI controls plus sensitive-name and
  sufficiently long inherited environment values.
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
- Milestone 4 was approved and committed as `df22df4` with message
  `feat: generate offline compatibility report`.

## Milestone 5 — Complete and accepted: CLI completeness

Deliverables:

- Complete `init`, `doctor`, `scan`, `demo`, `clean`, and `version` commands.
- Locked exit-code behavior and unsupported-environment diagnostics.

Acceptance gate:

- Every command observes its write and safety contract.
- `init` does not overwrite configuration without `--force`.

Implementation evidence on 2026-07-17:

- Added complete Commander surfaces and usage examples for `init`, `doctor`, `scan`, `demo`,
  `clean`, and `version`. Help and short version exit `0`; malformed flags, commands, and values
  map to configuration exit `2` instead of the scan-incompatibility code.
- `init` deterministically inspects the repository-root `package.json`, declared package manager,
  npm/pnpm/yarn/bun lockfiles, recognized validation scripts, and base candidates. It writes only
  `branchmesh.config.json`, uses exclusive or atomic publication, rejects ambiguous managers and
  unsafe targets, and requires `--force` before replacing a regular config.
- `doctor` reuses production preflight without creating worktrees or reports. It checks platform,
  Node, Git, repository/common-directory identity, immutable refs, selected dirt, unsupported
  submodules/LFS, command entry points, and accessible temporary/report storage. Git status runs
  with optional index locks and fsmonitor disabled.
- `scan` loads the fixed repository-root config, reapplies Zod validation after base/branch,
  active-worktree, and dirty-state CLI overrides, then invokes the existing production engine and
  report path. Terminal progress, matrix, JSON/log/HTML paths, timeout, cancellation, and locked
  exit precedence remain engine-owned.
- `demo` retains the accepted temporary fixture, production scan engine, direct exit `1`, and
  success-returning verification harness. `version` reports BranchMesh, Node, Git, and operating
  system details and works outside a repository.
- Added a durable run lock and per-worktree `idle`/`git`/`command` activity evidence before process
  launch. `clean` is a dry run unless `--yes` or `--force` confirms it; it filters by canonical Git
  common directory, skips live or uncertain roots, claims stale roots exclusively, validates
  no-follow ownership/path/Git membership, runs only exact `git worktree remove --force <path>`,
  and never prunes broadly or touches report history.
- Package metadata now derives the CLI version from `package.json`, limits the tarball to `dist`,
  runs a build in `prepack`, and retains the existing Node 20+ bin contract.
- Added real-repository tests for configuration initialization/loading, doctor state preservation,
  full CLI scan output and exit `1`, stale/live/corrupt/non-idle cleanup, ownership-lock symlinks,
  invalid-base exit `3`, opener argv/cancellation, and Commander input errors.

Verification evidence:

- Formatting, linting, strict type-checking, build, and the complete 107-test/28-file suite pass.
- The real demo verifier passes with three independently passing branches, one
  `BEHAVIORAL_CONFLICT` with `PAIR_TEST_FAILURE`, two `NO_DETECTED_CONFLICT` pairs, unchanged
  project state, and no remaining temporary worktrees.
- `npm pack` invokes `prepack` and produces four entries only: `package.json`, the executable CLI,
  its declaration, and its source map. A fresh temporary-prefix install succeeds; the installed
  help and both version forms exit `0`, invalid input exits `2`, and its real demo exits `1` with
  the expected classifications.

Milestone boundary:

- No Codex skill, caching, remote integration, new combination semantics, or product-output UI was
  added in Milestone 5.
- The accepted implementation was committed as `d6017c8` with message
  `feat: complete BranchMesh CLI workflow`.

## Milestone 6 — Implemented; acceptance pending: Codex skill and documentation

Deliverables:

- Repository-scoped skill, workflow script, references, and metadata.
- README, architecture, safety, troubleshooting, and judge-testing documentation.

Acceptance gate:

- Codex can invoke BranchMesh, validate the result, explain evidence, and avoid absolute safety
  claims without modifying code unless asked.

Implementation evidence on 2026-07-17:

- Added the repository-scoped `.agents/skills/branchmesh` package with minimal trigger metadata,
  generated `agents/openai.yaml`, a doctor-first workflow, focused classification/troubleshooting
  references, and one local Node wrapper.
- The wrapper has a closed selection interface for two-to-five named refs, active worktrees, or an
  explicitly accepted configured selection. It resolves the local compiled CLI relative to the
  skill, uses argv arrays with `shell: false`, rejects `--ignore-dirty`, and passes
  `--no-ignore-dirty` to both CLI children so config cannot weaken the skill's clean-worktree rule.
  It forwards interruption and never invokes init, clean, open, a package installer, or a network
  service.
- Added a narrow `dist/contracts.js` build entry exporting the production config and result Zod
  schemas. The skill reads only the exact result path from its invocation, checks published
  redaction, requested ref/SHA provenance and process/result exit agreement, and emits a bounded
  evidence envelope rather than duplicating the scanning engine or result contract.
- Skill instructions treat branch/file/command/log text as untrusted evidence, require ambiguity
  resolution and doctor success, explain full captured SHAs and failed commands, use “No detected
  conflict under the configured commands,” and prohibit fixes without a separate request.
- Added a complete README plus architecture, safety, configuration, CLI, classification, supported
  platform, limitation, troubleshooting, and judge-testing guides. Documentation examples and
  classification coverage are checked against the live Zod contracts.
- Reconciled the accepted Milestone 5 commit history and expanded the decision/build records while
  keeping release artifacts and claims out of scope.

Verification evidence:

- Skill discovery/resource/frontmatter, closed selection, syntax, local argv process boundary,
  bounded envelope, documentation links, config examples, and complete taxonomy tests pass.
- A final-review regression failed first because checking the config once left a race in which it
  could enable `ignoreDirty` between doctor and scan. The CLI now accepts an explicit negative
  override and the wrapper passes it to both processes; the regression passes without changing the
  default CLI behavior.
- An independent forward test followed the skill, ran the deterministic production demo, reported
  full branch SHAs, one clean-merge `BEHAVIORAL_CONFLICT` with `PAIR_TEST_FAILURE`, failed
  `node --test` evidence, two “No detected conflict” pairs, limitations, and report locations, and
  made no source edit.
- `npm run verify` passes end to end: formatting, linting, strict type-checking, 116 tests across 30
  files, both build entries, the existing demo verifier, and the new skill demo verifier.
- The skill demo wrapper independently observes actual scan exit `1`, validates schema version 1,
  three `BRANCH_PASS` jobs, the expected pair classifications/technical classification, unchanged
  repository evidence, zero temporary worktrees, and ownership-verified removal of its ephemeral
  acceptance report.

Milestone boundary and remaining verification note:

- No scan-engine scheduling, merge, classification, or report semantic; report UI; cache; remote
  integration; automatic fix; release archive; checked-in distribution; screenshot; sample
  report; license; or submission asset was added.
- The skill-creator `quick_validate.py` tool was invoked, but the host Python stopped before reading
  the skill because its undeclared `yaml` module is absent. Repository tests cover the same
  frontmatter/name/description/resource rules, and a path-directed independent forward execution
  passed; actual host discovery remains a manual judge check. Rerunning the official helper in an
  environment with PyYAML remains a release check.
- Milestone 6 is not committed, pushed, tagged, published, or otherwise released.

## Milestone 7 — Not started: Release and submission verification

Deliverables:

- Prebuilt distribution, package archive, sample report, release verifier, screenshots, and
  submission documentation.

Acceptance gate:

- A fresh clone passes `npm ci`, `npm run verify`, and the deterministic demo.
- Supported-platform claims, offline behavior, links, licensing, and submission evidence are
  manually verified.
