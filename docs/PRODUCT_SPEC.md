# BranchMesh Product Contract

## Definition

BranchMesh is a local-first CLI and repository-scoped Codex skill that detects committed Git
branches which pass their configured checks independently but fail when combined. It uses
detached temporary worktrees, deterministic Git operations, project-defined validation commands,
schema-validated JSON, and a fully offline HTML compatibility report.

BranchMesh reports observed evidence only. A passing pair is described as **No detected
conflict**; it is never described as guaranteed safe.

## Locked MVP

- One Node.js 20+ TypeScript package managed with npm.
- Local JavaScript and TypeScript Git repositories.
- Active worktrees and explicitly selected local branches.
- A default maximum of five selected branches.
- A base job, one job per individual branch, and every unique eligible branch pair.
- Pairwise combinations only, in deterministic branch-name order.
- User-defined setup, test, type-check, lint, build, and custom validation commands.
- Git conflict, individual branch failure, behavioral conflict, timeout, setup failure, and
  unsupported or infrastructure failure reporting.
- Terminal output, schema-versioned JSON, and self-contained offline HTML.
- A deterministic, dependency-free demonstration repository.
- A repository-scoped Codex skill that runs the deterministic CLI and explains its evidence.

## Scan contract

Before execution, BranchMesh resolves the base and selected branches to immutable commit object
IDs. Branch refs may move afterward without affecting the scan.

The job graph is executed in this order:

1. Test the captured base commit.
2. For every branch, create a fresh worktree at the base and merge the captured branch commit.
3. For every pair whose individual branches passed, create a fresh worktree at the base and merge
   both captured commits in deterministic order.
4. Emit every planned pair in the result; pairs with a failing individual branch are
   `PAIR_SKIPPED`.

The MVP uses concurrency two, does not fail fast, and stops normal analysis when the base is
invalid. Continue-on-base-failure is not supported.

## Safety contract

- All execution worktrees, locks, ownership manifests, hook directories, and transient files live
  beneath a BranchMesh-owned directory created under `os.tmpdir()`.
- Persistent results live outside the scanned repository beneath a BranchMesh user-data root,
  grouped by repository fingerprint and run ID.
- `--output` may select a different persistent result destination.
- Scan-related commands never create or alter files in the scanned worktree.
- The demo fixture may be constructed in a BranchMesh-owned temporary directory; once scanning
  begins, that fixture is treated as an immutable scanned worktree.
- `branchmesh init` is the sole operation allowed to create `branchmesh.config.json` in the current
  repository and never overwrites it without `--force`.
- Dirty selected worktrees are rejected by default. Ignoring dirt scans only the captured commit.
- BranchMesh deletes only paths proven to be owned by the current or a recoverable BranchMesh run.

## Output locations

The default persistent data roots are:

- macOS: `~/Library/Application Support/BranchMesh`
- Linux and WSL: `$XDG_DATA_HOME/branchmesh` when set, otherwise
  `~/.local/share/branchmesh`

The logical layout is:

```text
<data-root>/repositories/<repository-fingerprint>/
├── runs/<run-id>/
│   ├── result.json
│   ├── report.html
│   └── logs/
└── latest/
    ├── result.json
    └── report.html
```

No environment values are stored in either result format.

## Classification and exit behavior

Every job has one primary causal classification. A pair verification failure uses
`BEHAVIORAL_CONFLICT` as its primary classification and may include a technical classification for
the failed command kind.

|  Exit | Meaning                                                              |
| ----: | -------------------------------------------------------------------- |
|   `0` | Every executed validation passed                                     |
|   `1` | A completed scan found a non-base branch or pair incompatibility     |
|   `2` | Configuration, infrastructure, ownership, report, or cleanup failure |
|   `3` | Invalid or failing base                                              |
|   `4` | Dirty or unsupported repository state                                |
| `130` | Interrupted by the user or termination signal                        |

## Supported environments

The MVP officially supports macOS, Linux, and WSL. Native Windows, Git submodules, and Git LFS
repositories are rejected as unsupported until their lifecycle and cleanup behavior is tested.

BranchMesh itself makes no runtime HTTP or model calls. User-configured commands are external
project programs and may have behavior outside BranchMesh's control.

## Explicit non-goals

- GitHub APIs, pull-request automation, or hosted dashboards.
- Accounts, authentication, databases, telemetry, or cloud storage.
- Runtime OpenAI API calls or automatic conflict repair in the CLI.
- Uncommitted-change snapshots.
- Three-way or higher-order branch combinations.
- React or another frontend framework for the report.
- Native Windows support during the MVP.
