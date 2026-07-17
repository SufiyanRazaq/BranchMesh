# BranchMesh safety model

BranchMesh is designed so a failed scan is inconvenient, not destructive. The critical boundary
is between a read-only user repository/worktree and BranchMesh-owned execution state beneath the
operating system temporary directory.

## Protected user state

Scan, doctor, demo scanning, clean inspection, and version must not alter the scanned worktree's:

- checked-out branch or `HEAD`;
- index;
- refs;
- tracked files;
- untracked files;
- existing user worktrees or their administrative records.

BranchMesh never runs checkout, switch, reset, clean, stash, merge, or rebase in a user worktree.
`branchmesh init` is the sole intentional exception to repository write-freedom: it may create or,
with `--force`, replace the root `branchmesh.config.json`.

## Read-only preflight and immutable snapshots

Preflight resolves the canonical repository root and common Git directory, parses
`git worktree list --porcelain -z`, validates supported state, checks selected-worktree dirt, and
resolves the base plus all selected branches to full 40- or 64-hex commit IDs before scheduling a
job.

Every later worktree add and merge uses captured IDs, never a moving branch ref. A ref changing
after the snapshot does not change the scan. Dirty selected worktrees are rejected by default.
General CLI `--ignore-dirty` scans the captured commit only and excludes all uncommitted content;
the Codex skill refuses that bypass entirely.

Native Windows, submodules, and Git LFS repositories are rejected for the MVP because their
worktree/cleanup lifecycle has not passed the adversarial safety suite.

## Owned execution root

Each run creates a private, collision-resistant `branchmesh-run-*` directory with `mkdtemp` under
`os.tmpdir()`. Branch names never become filesystem path components. The root contains:

- a no-follow ownership marker with a random token, run ID, and repository identity;
- a validated manifest listing only that run's worktrees;
- a durable process-owner lock;
- per-worktree activity evidence (`idle`, `git`, or `command`);
- an empty hooks directory;
- opaque detached job worktrees.

Ownership evidence is written before creating a worktree so a crash cannot leave an
undiscoverable checkout.

## Synthetic Git operations

Every base, individual branch, and pair job gets a fresh detached worktree at the captured base
commit. Synthetic merges:

- use captured commit IDs as argv values;
- run only inside the owned worktree;
- use a fixed local BranchMesh author/committer identity;
- disable commit signing;
- point `core.hooksPath` to the run-owned empty directory;
- scrub inherited Git context variables;
- collect unresolved file names and porcelain status on failure.

No global Git identity is required and repository hooks do not run. Worktree add, list, and remove
operations are serialized within a scan so concurrent jobs cannot race while Git updates its
shared worktree administration.

## Process boundary

Internal Git and operating-system calls use `spawn` or `execFile` with an executable, argument
array, explicit working directory, and `shell: false`. Dynamic refs, paths, and environment values
are never interpolated into configured command strings.

User-configured setup and validation strings are the sole `shell: true` boundary. They run
unchanged inside the detached worktree. They are user-selected project programs and may perform
arbitrary local or network behavior; inspect configuration before scanning.

The command runner starts a POSIX process group, captures bounded stdout and stderr separately,
and records exit, signal, timeout, and duration. On timeout or cancellation it terminates the
complete process tree, waits for process closure, and only then permits worktree cleanup. One root
AbortController receives SIGINT/SIGTERM and stops new scheduling.

## Ownership-verified cleanup

Per-job and run-level cleanup execute in `finally` paths after success, Git conflict, validation
failure, timeout, cancellation, exception, and report-publication failure. Removal is idempotent.

Before deleting a worktree or execution root, BranchMesh proves:

1. canonical containment beneath the exact owned run root;
2. regular, non-symlink ownership and manifest files opened with `O_NOFOLLOW`;
3. matching ownership token, run ID, and canonical common Git-directory identity;
4. exact manifest membership;
5. exact Git worktree registration for the target path;
6. no active process and an idle activity record.

It uses only exact `git worktree remove --force <owned-path>` operations. It never runs broad
`git worktree prune` and never deletes arbitrary `.git/worktrees` metadata.

## Conservative orphan recovery

`branchmesh clean` is scoped to the current canonical repository identity and is a dry run unless
`--yes` or `--force` confirms removal. `--force` is not a safety bypass.

Recovery additionally requires a stale owner, an exclusive cleanup claim, no live/uncertain lock,
idle activity, valid canonical paths, and exact Git membership. Missing, corrupt, mismatched,
symlinked, live, non-idle, or otherwise ambiguous evidence is retained for inspection. Completed
report history is never removed.

Uncatchable `SIGKILL` or power loss cannot execute JavaScript `finally` blocks. A partially created
root without complete proof, a stale cleanup claim, or an independently orphaned report-staging
root is deliberately retained instead of guessed safe. Safety takes precedence over aggressive
reclamation.

## Report boundary

Transient report staging uses its own ownership marker beneath `os.tmpdir()`. Persistent reports
are outside every discovered repository worktree:

- macOS: `~/Library/Application Support/BranchMesh`;
- Linux/WSL: `$XDG_DATA_HOME/branchmesh` or `~/.local/share/branchmesh`.

Default runs are grouped as `repositories/<fingerprint>/runs/<run-id>` and atomically refresh
external `latest` JSON/HTML files. `--output` chooses an exact external run directory and disables
the latest copy. Existing report artifacts, symlink destinations, non-directories, and locations
inside the repository/common Git directory/worktrees are refused.

The published `result.json` remains Zod-valid while replacing repository/common-Git paths with
`[redacted]` and worktree paths with `null`. HTML embeds a smaller separately validated projection.
No environment map is serialized. ANSI control sequences plus inherited values with sensitive
variable names or at least eight characters are redacted from published evidence; raw logs are
run-relative and separate. Relative changed-file names and configured-command output intentionally
remain. A short non-sensitive environment value echoed by a command cannot be distinguished from
ordinary output, so reports still require review before sharing.

Reports are not automatically share-safe. Branch names, full commit IDs, changed-file names,
configured command strings, and command output are intentional evidence and may reveal sensitive
project information. Review all artifacts before sharing them.

## Safety evidence

The test suite uses fresh real repositories beneath `os.tmpdir()` and snapshots branch, `HEAD`, raw
index bytes, refs, status, tracked and untracked content, worktree registrations, and Git
administrative entries before and after scans. It covers merge/command/setup/publication failures,
timeouts, repeated interruption, process descendants, hostile paths/refs, existing user worktrees,
hooks/signing/identity, symlink containment, corrupt ownership, idempotent cleanup, and orphan-free
normal completion.
