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
