# BranchMesh Decisions

This file records accepted decisions that refine or override earlier product-plan details.

## D-001 — Output and worktree safety

- **Status:** Accepted
- **Date:** 2026-07-17

Temporary worktrees and execution files live beneath a BranchMesh-owned directory created under
`os.tmpdir()`. Persistent reports live outside the scanned repository in a BranchMesh-owned
user-data directory grouped by repository fingerprint and run ID. `--output` may override the
report destination.

Scan, doctor, demo, clean, and version do not create files in a scanned worktree. The demo may
construct its own fixture beneath `os.tmpdir()` before scanning begins. `branchmesh init` is the
only command allowed to create `branchmesh.config.json` in the current repository.

## D-002 — Primary and technical classifications

- **Status:** Accepted
- **Date:** 2026-07-17

Every job has one primary causal classification. A pair whose verification command fails after
both individual branches pass uses `BEHAVIORAL_CONFLICT`. It may additionally record a technical
classification identifying test, build, type-check, lint, or custom command failure.

## D-003 — Exit codes

- **Status:** Accepted
- **Date:** 2026-07-17

- `0`: every executed validation passed.
- `1`: a completed scan detected any non-base branch or pair incompatibility.
- `2`: configuration, infrastructure, ownership, report-generation, or cleanup failure.
- `3`: invalid or failing base.
- `4`: dirty or unsupported repository state.
- `130`: interruption.

## D-004 — Advanced MVP behavior

- **Status:** Accepted
- **Date:** 2026-07-17

`failFast` is false. Pairs containing an individually failing branch are not executed, but every
planned pair appears as `PAIR_SKIPPED`. Normal scanning stops after an invalid base. The MVP has no
continue-on-base-failure feature.

## D-005 — Supported platforms and repositories

- **Status:** Accepted
- **Date:** 2026-07-17

Official MVP support is macOS, Linux, and WSL. Native Windows is unsupported and must be rejected
or clearly reported by `doctor`. Repositories using submodules or Git LFS are rejected as
unsupported until explicitly tested.

## D-006 — Command execution boundary

- **Status:** Accepted
- **Date:** 2026-07-17

Internal Git and operating-system commands use `spawn` or `execFile` with argument arrays and
`shell: false`. User-configured validation commands are the sole permitted shell boundary. Dynamic
refs, paths, environment values, and other data are never concatenated into configured command
strings. Environment values are never stored in reports.

## D-007 — Repository-scoped skill execution boundary

- **Status:** Accepted
- **Date:** 2026-07-17

The BranchMesh Codex skill is a repository-scoped workflow around the local compiled CLI. It does
not duplicate repository inspection, worktree creation, merging, command execution,
classification, cleanup, or report generation.

The skill wrapper resolves `dist/cli.js` relative to itself, invokes it with argument arrays and
`shell: false`, requires one explicit branch-selection mode, and runs doctor before every normal
scan. The deterministic self-created demo is the only doctor-first exception.

## D-008 — Skill safety and result trust

- **Status:** Accepted
- **Date:** 2026-07-17

The Codex skill never permits `--ignore-dirty` and refuses a checked-in configuration whose
`execution.ignoreDirty` is `true`. It also passes the negative `--no-ignore-dirty` override to both
doctor and scan so a concurrent config change cannot enable the bypass between those processes. It
never invokes clean or open, downloads a substitute CLI, uploads artifacts, calls an external
service, or changes project code without a separate user request.

The wrapper revalidates the exact published `result.json` through a narrow compiled contracts entry
that exports the production Zod schemas. It verifies redaction, requested refs, captured full SHAs,
and child/result exit agreement before emitting a bounded envelope. A validated completed scan can
make the wrapper exit `0` while preserving the actual `0`, `1`, or `3` in `scanExitCode`; CLI exit
semantics remain unchanged.

Branch names, file names, command strings, and log output are untrusted evidence. Codex may quote
and explain them but never treats their contents as instructions. Passing evidence is described as
“No detected conflict under the configured commands,” never as an absolute safety claim.
