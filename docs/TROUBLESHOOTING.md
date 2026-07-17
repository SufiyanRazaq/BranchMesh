# BranchMesh troubleshooting

Start with `branchmesh doctor` using the same base and selection you intend to scan. Doctor is
read-only and reports exact configuration/preflight failures where possible.

## Configuration is missing or invalid

```text
No branchmesh.config.json was found ... run branchmesh init
```

Run `branchmesh init` only when you intend to create repository configuration, then inspect the
generated commands. Existing files are preserved unless `--force` is supplied. Unknown config
keys, invalid timeouts, duplicate IDs, fewer than two explicit refs, or values outside the fixed
MVP limits exit `2` with field paths.

If init finds no recognized script, add a recognized root `package.json` script and rerun init, or
manually create a complete configuration that satisfies [Configuration](CONFIGURATION.md). If it
finds conflicting manager lockfiles, declare `packageManager` in root `package.json` or remove the
unintended lockfile yourself.

## Too few or too many branches

Active-worktree selection must produce 2–5 branches and obey `execution.maxBranches`. Use explicit
selection when active worktrees do not express the intended set:

```bash
branchmesh doctor --base main --branches feature/a,feature/b
```

Do not combine `--branches` and `--worktrees`. BranchMesh never silently truncates selection.

## Dirty selected worktree — exit 4

By default, commit or otherwise resolve the dirty state before scanning. General CLI
`--ignore-dirty` means “scan the captured committed tip and exclude uncommitted changes”; it does
not snapshot or test those changes. The Codex skill always refuses the bypass.

## Invalid or failing base — exit 3

If the base ref cannot resolve, fix the ref or `--base` value. If setup or validation fails on the
captured base, use the published base-only result to inspect `failedCommandId`, stderr/stdout,
timeout, and classification. Normal branch and pair execution does not run until the base passes.

## Individual failure and skipped pairs

A failing individual branch receives a branch classification such as `BRANCH_TEST_FAILURE` or
`BASE_MERGE_CONFLICT`. Every planned pair containing it is `PAIR_SKIPPED`. A skipped pair has no
compatibility evidence; diagnose the individual integration first.

## Missing executable or package script — exit 2

Doctor verifies statically discoverable executable entry points and package scripts without
running them. Correct the configured command or install repository dependencies through your
normal trusted process. Complex shell syntax and relative executable paths may be warnings that
are deferred until scan.

BranchMesh never downloads a missing executable and does not invoke `npx` automatically.

## Timeout

The failed command retains bounded partial logs. Increase only that setup/command `timeoutMs` when
the expected project behavior needs more time. Setup runs in every fresh worktree, so dependency
installation can dominate a multi-job scan.

## Output publication is refused

Choose the default external storage or a fresh external directory:

```bash
branchmesh scan --output ../branchmesh-report
```

BranchMesh refuses output inside the repository/common Git directory/any discovered worktree,
symlinked or non-directory destinations, and pre-existing conflicting `result.json`, `report.html`,
or `logs` artifacts. It will not overwrite a prior explicit run.

## `--open` fails after report generation

Opening uses `open` or `xdg-open`. A missing/headless opener changes the CLI outcome to exit `2`,
but the already-published report remains at the printed HTML path. Omit `--open` and open/copy the
file through your environment.

## Demo exits 1

This is expected for the direct demo: it intentionally detects one behavioral conflict.

```bash
node dist/cli.js demo
```

Use `npm run demo` for a success-returning acceptance harness. It returns `0` only after validating
the expected scan exit `1`, classifications, report, unchanged repository state, and cleanup.

## Cleanup entries are retained

Run `branchmesh clean` first as a dry run. Use `--yes` only for entries proven removable.

- `LIVE`: the owning process still appears active.
- `UNCERTAIN`: lock or activity evidence cannot prove inactivity.
- `REFUSED`: ownership, containment, identity, marker, manifest, or Git membership is missing or
  mismatched.

`--force` is merely confirmation and never overrides these checks. BranchMesh does not prune the
repository broadly and does not remove report history.

## Unsupported state — exit 4

Native Windows, Git submodules, and Git LFS repositories are unsupported for the MVP. Run on
macOS, Linux, or WSL in a repository without those features. BranchMesh does not fetch remote
objects, so all selected commits must already exist locally.

## Interrupted scan — exit 130

Wait for the CLI to finish process-tree termination and ownership-verified cleanup. Do not
force-delete a reported execution root. If a later dry-run clean cannot prove ownership and
inactivity, retain the root for manual inspection rather than weakening the safety checks.

## A result appears flaky

BranchMesh reports configured command observations. Run-to-run differences can come from flaky
tests, clocks, randomness, local services, network access inside configured commands, or mutable
external dependencies. Use the full SHA, failed command, captured logs, and duration to reproduce
under the project's normal debugging process; do not reinterpret a failed run as a passing one.
