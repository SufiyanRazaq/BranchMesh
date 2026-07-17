# BranchMesh Architecture

## Architectural shape

BranchMesh is one Node.js package with two connected surfaces:

1. A deterministic local engine that inspects Git, runs isolated jobs, and emits evidence.
2. A repository-scoped Codex skill that invokes the engine and interprets validated results.

There is no backend, database, runtime network client, model client, or frontend framework.

```text
Commander CLI
    │
    ├── Configuration loader and Zod validation
    ├── Repository inspector and immutable snapshot
    └── Scan engine
          ├── Deterministic job planner
          ├── Owned worktree and merge lifecycle
          ├── Configured command execution
          ├── Result classification
          └── Guaranteed cleanup
                    │
                    ├── Validated JSON
                    └── Self-contained HTML
```

## Dependency boundaries

```text
commands → config / git / engine / report
engine   → git / model / utils
report   → model
git      → model / utils
```

- `src/commands` parses CLI values and orchestrates application services.
- `src/config` owns schemas, defaults, loading, and CLI/config precedence.
- `src/git` is the sole internal Git boundary and contains no report behavior.
- `src/engine` owns planning, execution, classification, cancellation, and cleanup.
- `src/model` owns the Zod result schemas and inferred TypeScript types.
- `src/report` consumes validated results and cannot execute Git or engine operations.
- `src/demo` creates the temporary fixture and invokes the same scan service as normal scans.

## Repository snapshot

Preflight is read-only. It discovers the repository root and common Git directory, parses active
worktrees, validates supported state, detects dirt, resolves the base and branch refs to full commit
object IDs, and creates the immutable run snapshot. Every later operation uses these object IDs,
not live refs.

The planner creates a stable ordered graph:

```text
base → individual branches → eligible canonical pairs
```

Result order follows the plan even when jobs finish concurrently.

## Execution and persistent roots

Execution and evidence use separate roots:

- **Execution root:** a private, collision-resistant directory created with `mkdtemp` beneath
  `os.tmpdir()`. It contains locks, an ownership manifest, an empty hooks directory, opaque job
  directories, and detached worktrees.
- **Persistent root:** the platform user-data directory, organized as
  `repositories/<fingerprint>/runs/<run-id>`, or the explicit `--output` destination.

Neither root is inside the scanned repository. The repository fingerprint is derived from the
canonical Git common-directory identity and must not expose source content.

## Worktree lifecycle

Each job receives a fresh detached worktree at the captured base commit. Ownership is recorded
before worktree creation so a crash cannot leave an undiscoverable checkout. Branch names never
appear in filesystem paths.

Synthetic merges:

- use captured commit IDs;
- disable signing;
- use a fixed local BranchMesh author and committer identity;
- point `core.hooksPath` to the run-owned empty directory for checkout and merge operations;
- collect unresolved paths and porcelain status when Git reports failure.

Cleanup is idempotent and runs in per-job and run-level `finally` blocks. Before removal it proves
canonical containment, ownership token, run membership, repository identity, and exact Git
worktree membership. It never uses broad worktree pruning.

## Process model

Internal Git and operating-system processes use executable-plus-argument arrays with
`shell: false`. User-configured setup and validation strings are passed verbatim through the
platform shell and are never combined with dynamic values.

One root cancellation signal stops scheduling and propagates to active jobs. Timeout and signal
handling terminate complete process groups, await process exit, retain bounded partial logs, and
only then remove worktrees. Environment values are not serialized into artifacts.

## Result and report boundary

Zod is the source of truth for configuration and result validation. Results are validated before
atomic JSON publication and again before report rendering or Codex interpretation.

The report is one HTML file with embedded CSS, JavaScript, and sanitized result data. It uses no
CDN, external font, analytics, or runtime request. Raw log paths are run-relative and the embedded
report projection omits environment values and unnecessary local paths.

## Foundation status

The foundation contains package tooling, governance documents, directory boundaries, and a
minimal compile-only CLI. Git inspection, scan planning, worktrees, classification, reports, and
complete commands intentionally begin in later approved milestones.
