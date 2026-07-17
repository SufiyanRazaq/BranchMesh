# Current limitations

BranchMesh deliberately keeps the MVP narrow.

## Evidence boundary

- A passing pair means **No detected conflict** under the configured commands.
- BranchMesh does not prove defect-freedom, semantic correctness, production readiness, or general
  merge safety.
- Flaky, incomplete, environment-sensitive, or network-dependent project commands can create
  false confidence or apparent conflicts.
- The report records observed command/Git evidence; it does not infer intent or root cause with a
  model.

## Git and combination scope

- Committed branch tips only; uncommitted content is never snapshotted.
- Two to five selected branches.
- Pairwise combinations only.
- One canonical lexicographic merge order per pair.
- No reverse-order comparison.
- No three-way or higher-order combination testing.
- No remote fetch, GitHub API, pull-request integration, or automatic comments.
- No submodule or Git LFS support.

## Execution scope

- Base failure stops all downstream analysis; there is no continue-on-base-failure option.
- Pairs containing an individually failing branch are represented as `PAIR_SKIPPED` and not run.
- `failFast` is fixed at false.
- Concurrency is limited to one or two.
- Setup executes independently in every job worktree and can dominate runtime.
- Command pipelines stop at their first failure.
- No result cache or automatic flaky-test rerun.

## Platform and distribution scope

- macOS, Linux, and WSL only; native Windows is rejected.
- This development session exercised macOS. Linux/WSL release-matrix runs are pending.
- The package is private and not published to npm.
- The repository skill is discovered from this checkout; installing or linking only the packed CLI
  does not copy the skill into another repository.
- Prebuilt `dist`, a release archive, sample report, and screenshots belong to the final release
  milestone and are not yet tracked.

## Product scope

- No backend, accounts, database, telemetry, hosted dashboard, or runtime network client.
- No runtime OpenAI call or automatic AI conflict resolution.
- No automatic source fixes. Codex may propose or implement a fix only after a separate user
  request and must use a safe branch/worktree workflow.
- No React, Vue, or other report framework; the output is one vanilla offline HTML file.

## Cleanup caveats

Normal success/failure/timeout/cancellation paths are tested for cleanup. `SIGKILL` and power loss
cannot run in-process `finally` blocks. `branchmesh clean` conservatively recovers only execution
roots with complete ownership, identity, inactivity, and Git-membership proof. Ambiguous partial
roots, stale cleanup claims, and independently orphaned report stages are retained rather than
deleted speculatively.
