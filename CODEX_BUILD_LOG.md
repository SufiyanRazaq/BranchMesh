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

- **Status:** Complete; awaiting human approval before Milestone 2.
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

- No commit, push, publication, tag, or release was performed.
- Milestone 2 was not started.
