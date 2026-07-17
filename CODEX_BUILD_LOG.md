# Codex Build Log

## 2026-07-17 — Repository foundation

- **Status:** Complete
- **Scope:** Repository governance, documentation, package tooling, directory boundaries, and a
  minimal compile-only CLI.

Codex work:

- Preserved and clarified the authoritative product and workflow document paths.
- Translated the approved architecture and six locked decisions into repository guidance.
- Prepared the Node.js and TypeScript tooling foundation.
- Deliberately excluded scan, Git worktree, report UI, and complete command implementation.

Human decisions:

- Locked external report storage and OS-temporary execution storage.
- Locked primary versus technical classifications and exit-code meanings.
- Locked non-fail-fast behavior, pair skipping, and the invalid-base stop rule.
- Locked macOS, Linux, and WSL support and unsupported repository features.
- Locked the internal argv boundary and sole configured-command shell boundary.

Verification:

- `npm install` — passed.
- `npm run format:check` — passed after formatting the new product-contract summary; the two moved
  source documents remained byte-for-byte unchanged.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, one foundation test.
- `npm run build` — passed after pinning TypeScript 5.9 for tsup declaration-build
  compatibility.
- `npm run verify` — passed, including the deliberately minimal placeholder demo.

Advisory review:

- `npm audit` reports one low-severity advisory in development-only `esbuild` 0.27.7 through tsup
  and Vitest. It concerns the esbuild development server on native Windows; BranchMesh does not run
  that server and native Windows is outside the MVP, but the advisory remains open until upstream
  tooling accepts esbuild 0.28.1 or later.

Repository actions:

- No commit, push, publication, tag, or release was performed.

## 2026-07-17 — Milestone 1 serial vertical slice

- **Status:** Complete and approved; committed as `d8ab2b7`.
- **Scope:** One base, exactly two branches, one canonical pair, and one configured validation
  command executed serially in fresh detached worktrees.

Codex work:

- Confirmed the working tree was clean after foundation commit `9e74633` before editing.
- Added strict Zod contracts for the initial configuration, command, job, and run result shapes.
- Added the argv-only internal Git client, immutable ref snapshotting, owned execution manifests,
  detached worktree lifecycle, configured-command shell boundary, merge/classification path, and
  validated JSON persistence.
- Added a deterministic dependency-free repository fixture in which the base and both branches
  pass, the pair merges without textual conflicts, and the pair test fails behaviorally.
- Added a machine verification harness that requires the real scan process to exit `1` but exits
  `0` itself only after checking all expected evidence.
- Kept full scanning, concurrency, timeouts, preflight, durable logs, HTML, and the complete CLI
  suite out of this milestone.

Safety evidence:

- Execution roots, hooks, manifests, and detached worktrees are created under `os.tmpdir()`.
- Persistent output is canonicalized and rejected when it resolves inside the scanned repository.
- Cleanup verifies marker token, run identity, repository identity, canonical containment,
  manifest membership, and exact Git worktree membership; no repository-wide prune is used.
- Tests cover completed scans, invalid-base cleanup, cancellation cleanup, marker tampering,
  symlinked output paths, and configured-command background descendants.
- The demo verifier confirms unchanged BranchMesh repository state and zero remaining temporary
  worktrees.

Verification:

- `npm run format:check` — passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 13 tests across 7 files.
- `npm run build` — passed.
- `npm run demo` — passed; it rebuilt the CLI and invoked the verification harness.
- `npm run demo:verify` — passed; observed scan exit `1`, `BASE_PASS`, two `BRANCH_PASS` jobs,
  `BEHAVIORAL_CONFLICT`, `PAIR_TEST_FAILURE`, zero textual conflicts, and zero remaining temporary
  worktrees.

Remaining work and risks:

- Milestone 2 still needs full repository preflight, dirty-worktree handling, submodule and Git LFS
  rejection, more than two selected branches, complete pair planning, timeouts, bounded
  concurrency, and durable log handling.
- Crash recovery and broader adversarial Git fixtures remain for the safety milestone.
- Native Windows remains unsupported; macOS, Linux, and WSL require broader platform coverage.

Repository actions:

- The approved milestone was committed as `d8ab2b7` with message
  `feat: add isolated branch-pair vertical slice`.
- No push, publication, tag, or release was performed.

## 2026-07-17 — Milestone 2 deterministic scanning engine

- **Status:** Complete and approved; committed as `c5cd4e6`.
- **Scope:** Complete preflight, immutable multi-branch planning, base/individual/pair execution,
  bounded configured-command pipelines, stable classification, bounded concurrency, validated
  JSON, and cleanup. HTML and the complete CLI remain excluded.

Codex work:

- Confirmed the working tree was clean at Milestone 1 commit `d8ab2b7` before editing and reread
  all authoritative instructions and product documentation.
- Generalized the strict Zod configuration and result contracts to two through five branches,
  optional setup, ordered command pipelines, timeouts, bounded logs, all locked classifications,
  immutable full commit IDs, planned skipped pairs, summaries, and exit-code consistency.
- Added Node.js and Git version checks, macOS/Linux/WSL platform gating, repository and common Git
  identity, porcelain-`-z` worktree parsing, explicit and active-worktree branch selection,
  selected-worktree dirt detection, changed-file calculation, and submodule/Git LFS rejection.
- Added deterministic branch and canonical-pair planning. Proved the serial cleanup paths first,
  then enabled a concurrency-two scheduler whose result slots are fixed by plan index.
- Added setup and validation pipelines that stop on first failure, preserve bounded partial output,
  classify timeouts, and terminate detached process groups on timeout, cancellation, and shell
  exit before worktree cleanup.
- During acceptance review, added a failing regression test that proved internal Git cancellation
  rejected before the child `close` event. Updated `GitClient` to wait for process closure and kill
  any remaining detached process-group members before cleanup can continue.
- Serialized ownership-manifest mutation for concurrent jobs and made cleanup idempotent when an
  earlier removal completed before its manifest-state update.
- Expanded the deterministic fixture to three passing branches and three pairs; only
  `feature/config-seconds + feature/jitter` fails verification after a clean Git merge.
- Kept HTML, durable raw-log files, full CLI commands, skill work, caching, merge-order tests,
  higher-order combinations, native Windows, remotes, submodule/LFS execution, and Milestone 3 out
  of scope.

Safety and acceptance evidence:

- All internal Git calls remain executable-plus-argv with `shell: false` and explicit `cwd`;
  configured setup and validation strings remain the only `shell: true` boundary.
- Every ref is resolved before ownership creation or scheduling. Merges use captured SHAs only and
  occur in detached worktrees under an ownership-marked `os.tmpdir()` root.
- Persistent output is rejected inside the scanned root, common Git directory, or any discovered
  worktree. The writer validates the complete run result and publishes `result.json` atomically.
- Tests cover three-branch planning, every canonical pair, failed-branch pair skipping, base stop,
  setup ordering, first-failure stop, bounded logs, timeout, process descendants, concurrent
  ordering, interruption, dirty selected worktrees, unsupported platform/features, output
  publication failure, and cleanup idempotence.
- The original demo repository state is compared before and after scanning, and fixture tests
  verify no registered BranchMesh worktrees or execution roots remain.

Verification:

- The serial cleanup gate passed before concurrency was enabled: 27 tests across 11 files.
- `npm run format:check` — passed after one mechanical formatting correction to the cleanup
  regression test.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed under the strict TypeScript configuration.
- `npm test` — passed, 41 tests across 16 files, including real temporary Git repositories and
  bounded-concurrency cleanup.
- `npm run build` — passed, including declaration generation.
- `npm run demo:verify` — passed; the real scan exited `1` as expected, while the harness verified
  `BASE_PASS`, three `BRANCH_PASS` jobs, three planned pairs, one `BEHAVIORAL_CONFLICT` with
  `PAIR_TEST_FAILURE`, two `NO_DETECTED_CONFLICT` pairs, unchanged repository state, and zero
  temporary worktrees.

Remaining work and risks:

- Git 2.31 is the conservative Milestone 2 minimum selected for the porcelain-`-z` and worktree
  feature set; the product plan did not lock an exact minimum, so broader compatibility testing
  remains necessary.
- Linux and WSL execution are supported by design but were not exercised in this macOS session.
- Abrupt-process crash recovery and the full adversarial Git lifecycle matrix remain Milestone 3.
- Durable raw logs and HTML sanitization remain Milestone 4; the engine currently carries only
  bounded command output in validated JSON.

Repository actions:

- The approved milestone was committed as `c5cd4e6` with message
  `feat: add deterministic branch scanning engine`.
- No push, publication, tag, or release was performed.

## 2026-07-17 — Milestone 3 adversarial safety gate

- **Status:** Implemented and locally verified; awaiting human acceptance.
- **Scope:** Real temporary Git fixtures and adversarial Git, process-tree, ownership, state
  preservation, and cleanup testing. No product-output or CLI feature work was added.

Codex work:

- Confirmed a clean working tree at accepted Milestone 2 commit `c5cd4e6` and reread the complete
  product and safety contracts before editing.
- Added an ownership-marked `TemporaryGitRepository` helper that creates every fixture beneath
  `os.tmpdir()`, uses fixed per-command commit identity, and deletes only its verified root.
- Added full repository-state capture for branch, HEAD, raw index bytes, refs, status, tracked and
  untracked contents, worktree registrations, and Git worktree administrative entries.
- Added real-repository outcome tests for passing pairs, behavioral and textual conflicts,
  invalid baseline, individual failures, skipped pairs, setup and every command kind, timeout,
  missing executable, and pre-execution infrastructure failure.
- Added adversarial Git tests for dirty selected worktrees, space and non-ASCII paths, hostile
  branch names, moving refs after snapshot, existing user worktrees, hooks, signing, global Git
  identity, and preservation of dirty tracked and untracked files under `ignoreDirty`.
- Added process tests for repeated interruption, child and grandchild termination, cancellation,
  and atomic result-publication failure, with ownership-verified cleanup evidence.
- Added ownership tests for lexical and symlink containment, missing, corrupt, and mismatched
  metadata, recovery after safe refusal, idempotent cleanup, and orphan-free Git administration.

Confirmed defect and regression:

- A regression test first demonstrated that a matching ownership marker or manifest reached
  through a symlink was accepted.
- The ownership reader now rejects non-regular and symlinked metadata and opens the file with
  `O_NOFOLLOW`, closing the substitution window before cleanup trusts its contents.
- The new regression and adjacent ownership lifecycle suite pass after the fix.

Safety evidence:

- Every new scan test operates only on its own temporary fixture; none runs a mutation command
  against the BranchMesh repository.
- Before/after snapshots are exact, including existing user worktrees and administrative entries.
- Cleanup assertions cover success, textual merge conflict, verification and setup failure,
  timeout, first and repeated signals, process descendants, ownership refusal and recovery, and
  report-publication failure.
- No `branchmesh-run-*` execution root or temporary worktree registration remained after either
  complete-suite run.

Verification:

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed under strict TypeScript.
- `npm test` — passed twice consecutively after the fix, 75 tests across 20 files per run.
- `npm run build` — passed, including ESM output, source map, and declaration generation.
- `npm run demo:verify` — passed; the real demo scan exited `1` for the expected incompatibility
  while the harness verified three passing branches, one behavioral conflict with
  `PAIR_TEST_FAILURE`, two passing pairs, unchanged project state, and zero temporary worktrees.
- `npm run verify` — passed end to end and included the second consecutive post-fix 75-test run.

Remaining work and risks:

- The tests ran on macOS in this session. Linux and WSL are supported by design but still require
  execution in those environments; native Windows remains intentionally unsupported.
- Process-group termination depends on POSIX process-group semantics, and `O_NOFOLLOW` depends on
  the supported macOS/Linux/WSL filesystem behavior.
- Power loss or `SIGKILL` cannot execute in-process `finally` cleanup. A complete orphan-recovery
  command remains part of the later CLI milestone rather than this test-only milestone.
- Durable raw logs and offline HTML remain Milestone 4 and were not started.

Repository actions:

- No commit, push, publication, tag, or release was performed.
- Milestone 4 was not started.
