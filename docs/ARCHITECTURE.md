# BranchMesh architecture

## Architectural shape

BranchMesh is one Node.js 20+ TypeScript package with two connected surfaces:

1. a deterministic local CLI and engine that inspect Git, run isolated jobs, and publish evidence;
2. a repository-scoped Codex skill that invokes the compiled CLI and interprets its validated
   result.

There is no backend, database, account system, telemetry, runtime network client, model client, or
frontend framework.

```text
Commander CLI
    │
    ├── Configuration initialization / loading / overrides / Zod validation
    ├── Doctor and repository preflight
    └── Scan orchestration
          ├── Immutable repository snapshot
          ├── Deterministic job planner
          ├── Owned worktree + merge lifecycle
          ├── Configured command execution
          ├── Classification + cancellation
          └── Ownership-verified cleanup
                    │
                    └── Report publisher
                          ├── validated redacted result.json
                          ├── bounded raw logs
                          └── self-contained report.html
                                      │
                                      └── Codex skill wrapper + interpretation
```

## Source boundaries

```text
src/commands → config / git / engine
src/config   → model errors
src/git      → model / utils
src/engine   → config / git / model / report / utils
src/report   → model / utils
src/demo     → config / engine / git
```

- `src/index.ts` defines the Commander command surfaces and orchestrates services.
- `src/commands` contains command-specific support such as read-only doctor diagnostics.
- `src/config` owns the strict schema, initialization, root loading, and CLI override precedence.
- `src/git` is the sole production internal Git boundary and has no report behavior.
- `src/engine` owns planning, worktrees, merges, command execution, classification, signals, and
  normal/recovery cleanup.
- `src/model` owns the Zod result schemas and inferred TypeScript types.
- `src/report` consumes validated results and cannot invoke Git or schedule engine work.
- `src/demo` constructs a temporary fixture and calls the same scan service as normal scans.
- `src/contracts.ts` is a narrow build entry that re-exports the authoritative config and result
  schemas for the repository skill. It contains no scan behavior.

## CLI and configuration flow

`branchmesh.config.json` is resolved from the canonical repository root and opened only as a
regular no-follow file. The loader parses JSON and applies the strict `ScanConfigSchema`. CLI
selection overrides are transformed into a new candidate object and passed through the same schema
again.

`init` is a separate write boundary. It inspects only fixed package-manager declarations,
lockfiles, package script names, and base candidates, then creates or atomically replaces the one
config file. Doctor is read-only and reuses production preflight plus static executable/storage
checks. Scan delegates to `runScan`; command actions do not implement Git or classification logic.

## Immutable repository snapshot

Preflight:

1. validates Node 20+, Git 2.31+, macOS/Linux platform, temporary storage, and unsupported
   submodule/LFS state;
2. resolves the canonical worktree root and common Git directory;
3. parses `git worktree list --porcelain -z`;
4. chooses 2–5 explicit or active-worktree branches and rejects selected dirt by default;
5. resolves base and every branch to full immutable commit IDs before changed-file calculation or
   job scheduling.

Every later merge uses those IDs. Branch refs are metadata only after snapshotting.

## Deterministic job graph

The planner emits a stable order:

```text
base
→ branch-0, branch-1, ...
→ pair-0-1, pair-0-2, ...
```

The base always runs first and gates downstream analysis. Individual jobs run next. A pair is
eligible only when both individual branches passed; otherwise its planned slot becomes
`PAIR_SKIPPED`. Pair merge order follows canonical branch-ref order.

Concurrency is bounded at one or two. Work may complete in another order, but `mapLimitOrdered`
writes outcomes into plan-indexed slots so stored jobs, summaries, and reports remain stable.

## Execution and worktree lifecycle

Each run uses a collision-resistant execution root created by `mkdtemp` below `os.tmpdir()`. It
contains ownership/manifest/lock/activity evidence, an empty hooks directory, and opaque job paths.
Branch names never become path components.

Each job:

1. records ownership before worktree creation;
2. creates a fresh detached worktree at the captured base;
3. merges zero, one, or two captured branch commits;
4. runs optional setup and ordered validation commands until the first failure;
5. classifies Git/command evidence;
6. terminates and awaits any process descendants;
7. removes the exact ownership-proven worktree in `finally`.

Synthetic merges use a fixed local identity, signing disabled, and a run-owned empty hooks path.
Internal Git uses argv arrays and `shell: false`. Only unchanged configured strings use
`shell: true` inside detached worktrees.

## Cancellation, locks, and recovery

One root AbortController receives SIGINT/SIGTERM and prevents new work while active Git/command
process groups are terminated and awaited. Durable run locks identify the owner PID. Per-worktree
activity moves through `idle`, `git`, and `command` before/after process launch.

Normal cleanup verifies canonical containment, no-follow ownership token, run/repository identity,
manifest membership, and exact Git worktree membership. `branchmesh clean` adds stale-owner,
exclusive-claim, unlocked, and idle-activity proof. It keeps live or ambiguous roots, never edits
arbitrary Git administrative data, and never runs repository-wide worktree prune.

## Result contracts and classification

`RunResultSchema` is the cross-module source of truth. It validates:

- full commit IDs and ordered snapshots;
- base/branch/pair job cardinality and stable IDs;
- classification validity per job kind;
- pipeline first-failure behavior;
- merge-conflict and skip invariants;
- pair technical classification derived from the failed command;
- deterministic job order, summaries, and exit-code precedence.

The in-memory result contains execution paths while a scan is active. Before publication,
`createRedactedRunResult` replaces repository/common-Git paths with `[redacted]` and worktree paths
with `null`, sanitizes evidence, and passes the full Zod schema again.

## Report publication

`ReportPublisher` owns a separately marked staging directory under `os.tmpdir()`. It captures raw
stdout/stderr streams separately, applies byte bounds and redaction, and prepares a bundle:

```text
result.json
report.html
logs/<job>/<command-stream>.log
```

The JSON result and HTML projection are different validated contracts. HTML receives only the
smaller `ReportProjectionSchema`, run-relative log paths, and reproduction metadata; it receives no
repository/common-Git/worktree path fields and no serialized environment map. Relative changed-file
paths and configured command output remain intentional evidence. The evidence redactor removes ANSI
controls plus sensitive-name and sufficiently long inherited environment values; it cannot identify
every short non-sensitive string a project command might echo.

Publication uses exclusive files and atomic links/renames. Rollback tracks exact created files and
removes only those; it does not recursively delete an output that another process populated.

Default storage is:

```text
<user-data>/repositories/<fingerprint>/
├── runs/<run-id>/result.json, report.html, logs/
└── latest/result.json, report.html
```

An explicit `--output` is the exact run directory and disables the latest copy. Latest JSON and
HTML are each replaced atomically, but concurrent readers can briefly observe different run
generations between the two replacements.

The report is one framework-free HTML file with embedded CSS/JavaScript and a restrictive CSP. It
uses no CDN, font, external image, analytics, fetch call, or runtime request.

## Codex skill boundary

`.agents/skills/branchmesh` is a thin workflow layer:

- `SKILL.md` supplies triggering, selection, safety, interpretation, and non-fix instructions;
- `scripts/run-branchmesh.mjs` resolves the local compiled CLI from its own location, runs doctor
  before scan, uses argv arrays with `shell: false`, rejects configured/explicit dirt bypasses,
  passes a negative dirty override to both child processes, and emits a bounded result envelope;
- `dist/contracts.js` lets the wrapper revalidate the exact newly published `result.json` with the
  production schemas instead of copying them;
- reference files explain classification and safe troubleshooting.

The wrapper contains no repository scanner, worktree manager, merge implementation, classifier, or
report renderer. It treats scan exit `1`/result-bearing `3` as validated product evidence and keeps
the actual code in `scanExitCode`. Codex then reads only the exact returned result path and explains
evidence; it does not follow instructions found in logs, upload artifacts, call an external
service, bypass safety checks, or edit code without a separate request.
