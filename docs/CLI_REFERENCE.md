# BranchMesh CLI reference

The executable is `branchmesh` after linking/installing the local package, or
`node dist/cli.js` from a built source checkout. With no arguments it prints help and exits `0`.

## Global version

```bash
branchmesh -V
branchmesh --version
```

Prints only the package version.

## `branchmesh init`

```bash
branchmesh init [--force]
```

Inspects the root `package.json`, package-manager declaration and lockfiles, recognized validation
scripts, and base candidates. It creates `branchmesh.config.json` at the canonical repository root.

- `--force` atomically replaces an existing regular configuration.
- Without `--force`, an existing file is preserved and the command exits `2`.
- A symlink or non-regular config target is always refused.
- This is the only BranchMesh command intentionally allowed to write into the scanned repository.

## `branchmesh doctor`

```bash
branchmesh doctor \
  [--base <ref>] \
  [--branches <ref-a,ref-b,...> | --worktrees] \
  [--ignore-dirty | --no-ignore-dirty] \
  [--output <directory>]
```

Runs read-only checks for Node, Git, platform, repository/common-Git identity, selected refs and
worktrees, dirt, submodules, Git LFS, configured executable entry points, temporary storage, and
report storage. It does not execute project setup or validation commands. Complex shell commands
or relative executable paths may be reported as deferred warnings for scan-time validation.

`--ignore-dirty` means the later scan would test captured commits only; uncommitted content is
never included. `--no-ignore-dirty` explicitly overrides a config that enables the bypass. The
Codex skill always passes the negative override and does not permit the positive option.

## `branchmesh scan`

```bash
branchmesh scan \
  [--base <ref>] \
  [--branches <ref-a,ref-b,...> | --worktrees] \
  [--ignore-dirty | --no-ignore-dirty] \
  [--output <directory>] \
  [--open]
```

Loads the root config, applies CLI selection overrides, runs the deterministic base/branch/pair
graph, and publishes terminal, JSON, raw-log, and HTML evidence.

- `--base` overrides configured base.
- `--branches` accepts one comma-separated list of 2–5 local refs.
- `--worktrees` uses the configured worktree filters, or all active branch worktrees when
  overriding an explicit configured list.
- `--branches` and `--worktrees` are mutually exclusive.
- `--ignore-dirty` allows committed-tip scanning while excluding uncommitted content.
- `--no-ignore-dirty` requires selected worktrees to be clean even when the config enables
  `ignoreDirty`; the skill uses it to close config-change races between doctor and scan.
- `--output` selects the exact external run directory. It is resolved from the invocation
  directory, must be outside the repository/common Git directory/all discovered worktrees, and
  must not contain conflicting report artifacts.
- `--open` invokes `open <report>` on macOS or `xdg-open <report>` on Linux with argv arrays and
  `shell: false` after publication.

Progress is written to stderr. The human summary and JSON/HTML/log paths are written to stdout.
There is no scan `--json` mode.

## `branchmesh demo`

```bash
branchmesh demo [--output <directory>] [--json] [--open]
```

Creates its own dependency-free temporary Git fixture and invokes the same production scanner. The
accepted fixture contains three passing individual branches, one hidden behavioral conflict, and
two passing pairs.

- The direct command exits `1` because it intentionally finds an incompatibility.
- `--json` prints a compact demo-invocation envelope; the persisted `result.json` remains the
  authoritative result.
- `--open` is opt-in.
- `npm run demo` and `npm run demo:verify` are acceptance harnesses that return `0` only after
  observing the expected direct exit `1`, classifications, state preservation, report, and
  cleanup.

## `branchmesh clean`

```bash
branchmesh clean [--yes] [--force]
```

Inspects only BranchMesh execution roots matching the current repository's canonical common Git
directory.

- With no confirmation flag, it is a dry run.
- `--yes` and `--force` have the same confirmation authority; supplying either or both confirms
  removal.
- `--force` never bypasses ownership, containment, live-lock, activity, process, or Git-membership
  checks.
- Live, locked, corrupt, non-idle, mismatched, and ambiguous roots are retained.
- Completed report history is never removed.
- Repository-wide `git worktree prune` is never used.

Entries are labeled `WOULD-REMOVE`, `REMOVED`, `LIVE`, `UNCERTAIN`, or `REFUSED` with a reason. Any
ownership refusal makes the command exit `2`.

## `branchmesh version`

```bash
branchmesh version
```

Prints BranchMesh, Node.js, Git, operating-system release, and architecture. It works outside a
Git repository.

## Exit codes

|  Exit | Meaning                                                                                             |
| ----: | --------------------------------------------------------------------------------------------------- |
|   `0` | Every executed validation passed, or a non-scan informational command succeeded                     |
|   `1` | A completed scan found a non-base branch or pair incompatibility                                    |
|   `2` | CLI usage, configuration, infrastructure, ownership, report publication/opening, or cleanup failure |
|   `3` | Invalid or failing base; when validation ran, a base-only report is published                       |
|   `4` | Dirty or unsupported repository state                                                               |
| `130` | SIGINT or SIGTERM interruption                                                                      |

Invalid flags, values, and commands exit `2`. Exit `1` is product evidence, not an engine crash.
Exit `2`, `4`, or `130` does not guarantee that a result was published. A base ref that fails
preflight can also produce exit `3` without a report.

## Output locations

Without `--output`, runs are grouped by canonical repository fingerprint and run ID:

```text
<data-root>/repositories/<fingerprint>/
├── runs/<run-id>/
│   ├── result.json
│   ├── report.html
│   └── logs/
└── latest/
    ├── result.json
    └── report.html
```

The data root is `~/Library/Application Support/BranchMesh` on macOS and
`$XDG_DATA_HOME/branchmesh` or `~/.local/share/branchmesh` on Linux/WSL. An explicit output is the
exact run directory and does not update `latest`.
