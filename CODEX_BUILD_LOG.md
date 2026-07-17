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

- **Status:** Complete and approved; committed as `d8ab2b7`.
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

- The approved milestone was committed as `d8ab2b7` with message
  `feat: add isolated branch-pair vertical slice`.
- No push, publication, tag, or release was performed.

## 2026-07-17 — Milestone 2 deterministic scanning engine

- **Status:** Complete and approved; committed as `c5cd4e6`.
- **Scope:** Complete preflight, immutable multi-branch planning, base/individual/pair execution,
  bounded configured-command pipelines, stable classification, bounded concurrency, validated
  JSON, and cleanup. HTML and the complete CLI remain excluded.

Codex work:

- Confirmed the working tree was clean at Milestone 1 commit `d8ab2b7` before editing and reread
  all authoritative instructions and product documentation.
- Generalized the strict Zod configuration and result contracts to two through five branches,
  optional setup, ordered command pipelines, timeouts, bounded logs, all locked classifications,
  immutable full commit IDs, planned skipped pairs, summaries, and exit-code consistency.
- Added Node.js and Git version checks, macOS/Linux/WSL platform gating, repository and common Git
  identity, porcelain-`-z` worktree parsing, explicit and active-worktree branch selection,
  selected-worktree dirt detection, changed-file calculation, and submodule/Git LFS rejection.
- Added deterministic branch and canonical-pair planning. Proved the serial cleanup paths first,
  then enabled a concurrency-two scheduler whose result slots are fixed by plan index.
- Added setup and validation pipelines that stop on first failure, preserve bounded partial output,
  classify timeouts, and terminate detached process groups on timeout, cancellation, and shell
  exit before worktree cleanup.
- During acceptance review, added a failing regression test that proved internal Git cancellation
  rejected before the child `close` event. Updated `GitClient` to wait for process closure and kill
  any remaining detached process-group members before cleanup can continue.
- Serialized ownership-manifest mutation for concurrent jobs and made cleanup idempotent when an
  earlier removal completed before its manifest-state update.
- Expanded the deterministic fixture to three passing branches and three pairs; only
  `feature/config-seconds + feature/jitter` fails verification after a clean Git merge.
- Kept HTML, durable raw-log files, full CLI commands, skill work, caching, merge-order tests,
  higher-order combinations, native Windows, remotes, submodule/LFS execution, and Milestone 3 out
  of scope.

Safety and acceptance evidence:

- All internal Git calls remain executable-plus-argv with `shell: false` and explicit `cwd`;
  configured setup and validation strings remain the only `shell: true` boundary.
- Every ref is resolved before ownership creation or scheduling. Merges use captured SHAs only and
  occur in detached worktrees under an ownership-marked `os.tmpdir()` root.
- Persistent output is rejected inside the scanned root, common Git directory, or any discovered
  worktree. The writer validates the complete run result and publishes `result.json` atomically.
- Tests cover three-branch planning, every canonical pair, failed-branch pair skipping, base stop,
  setup ordering, first-failure stop, bounded logs, timeout, process descendants, concurrent
  ordering, interruption, dirty selected worktrees, unsupported platform/features, output
  publication failure, and cleanup idempotence.
- The original demo repository state is compared before and after scanning, and fixture tests
  verify no registered BranchMesh worktrees or execution roots remain.

Verification:

- The serial cleanup gate passed before concurrency was enabled: 27 tests across 11 files.
- `npm run format:check` — passed after one mechanical formatting correction to the cleanup
  regression test.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed under the strict TypeScript configuration.
- `npm test` — passed, 41 tests across 16 files, including real temporary Git repositories and
  bounded-concurrency cleanup.
- `npm run build` — passed, including declaration generation.
- `npm run demo:verify` — passed; the real scan exited `1` as expected, while the harness verified
  `BASE_PASS`, three `BRANCH_PASS` jobs, three planned pairs, one `BEHAVIORAL_CONFLICT` with
  `PAIR_TEST_FAILURE`, two `NO_DETECTED_CONFLICT` pairs, unchanged repository state, and zero
  temporary worktrees.

Remaining work and risks:

- Git 2.31 is the conservative Milestone 2 minimum selected for the porcelain-`-z` and worktree
  feature set; the product plan did not lock an exact minimum, so broader compatibility testing
  remains necessary.
- Linux and WSL execution are supported by design but were not exercised in this macOS session.
- Abrupt-process crash recovery and the full adversarial Git lifecycle matrix remain Milestone 3.
- Durable raw logs and HTML sanitization remain Milestone 4; the engine currently carries only
  bounded command output in validated JSON.

Repository actions:

- The approved milestone was committed as `c5cd4e6` with message
  `feat: add deterministic branch scanning engine`.
- No push, publication, tag, or release was performed.

## 2026-07-17 — Milestone 3 adversarial safety gate

- **Status:** Complete and approved; committed as `d30f153`.
- **Scope:** Real temporary Git fixtures and adversarial Git, process-tree, ownership, state
  preservation, and cleanup testing. No product-output or CLI feature work was added.

Codex work:

- Confirmed a clean working tree at accepted Milestone 2 commit `c5cd4e6` and reread the complete
  product and safety contracts before editing.
- Added an ownership-marked `TemporaryGitRepository` helper that creates every fixture beneath
  `os.tmpdir()`, uses fixed per-command commit identity, and deletes only its verified root.
- Added full repository-state capture for branch, HEAD, raw index bytes, refs, status, tracked and
  untracked contents, worktree registrations, and Git worktree administrative entries.
- Added real-repository outcome tests for passing pairs, behavioral and textual conflicts,
  invalid baseline, individual failures, skipped pairs, setup and every command kind, timeout,
  missing executable, and pre-execution infrastructure failure.
- Added adversarial Git tests for dirty selected worktrees, space and non-ASCII paths, hostile
  branch names, moving refs after snapshot, existing user worktrees, hooks, signing, global Git
  identity, and preservation of dirty tracked and untracked files under `ignoreDirty`.
- Added process tests for repeated interruption, child and grandchild termination, cancellation,
  and atomic result-publication failure, with ownership-verified cleanup evidence.
- Added ownership tests for lexical and symlink containment, missing, corrupt, and mismatched
  metadata, recovery after safe refusal, idempotent cleanup, and orphan-free Git administration.

Confirmed defect and regression:

- A regression test first demonstrated that a matching ownership marker or manifest reached
  through a symlink was accepted.
- The ownership reader now rejects non-regular and symlinked metadata and opens the file with
  `O_NOFOLLOW`, closing the substitution window before cleanup trusts its contents.
- The new regression and adjacent ownership lifecycle suite pass after the fix.

Safety evidence:

- Every new scan test operates only on its own temporary fixture; none runs a mutation command
  against the BranchMesh repository.
- Before/after snapshots are exact, including existing user worktrees and administrative entries.
- Cleanup assertions cover success, textual merge conflict, verification and setup failure,
  timeout, first and repeated signals, process descendants, ownership refusal and recovery, and
  report-publication failure.
- No `branchmesh-run-*` execution root or temporary worktree registration remained after either
  complete-suite run.

Verification:

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed under strict TypeScript.
- `npm test` — passed twice consecutively after the fix, 75 tests across 20 files per run.
- `npm run build` — passed, including ESM output, source map, and declaration generation.
- `npm run demo:verify` — passed; the real demo scan exited `1` for the expected incompatibility
  while the harness verified three passing branches, one behavioral conflict with
  `PAIR_TEST_FAILURE`, two passing pairs, unchanged project state, and zero temporary worktrees.
- `npm run verify` — passed end to end and included the second consecutive post-fix 75-test run.

Remaining work and risks:

- The tests ran on macOS in this session. Linux and WSL are supported by design but still require
  execution in those environments; native Windows remains intentionally unsupported.
- Process-group termination depends on POSIX process-group semantics, and `O_NOFOLLOW` depends on
  the supported macOS/Linux/WSL filesystem behavior.
- Power loss or `SIGKILL` cannot execute in-process `finally` cleanup. A complete orphan-recovery
  command remains part of the later CLI milestone rather than this test-only milestone.
- Durable raw logs and offline HTML remain Milestone 4 and were not started.

Repository actions:

- The approved milestone was committed as `d30f153` with message
  `test: add adversarial Git safety coverage`.
- No push, publication, tag, or release was performed.

## 2026-07-17 — Milestone 4 terminal and offline reports

- **Status:** Implemented and locally verified; awaiting human acceptance.
- **Scope:** Terminal progress and summary, external persistent report storage, bounded separate
  logs, validated redaction, and one self-contained offline HTML report. No new CLI command or
  scanning feature was added.

Codex work:

- Confirmed a clean working tree at accepted Milestone 3 commit `d30f153` and reread all
  authoritative safety, architecture, product, and decision documents before editing.
- Added structured progress events around the existing deterministic job path without changing
  scheduling, pair eligibility, classifications, exit precedence, or stored job order.
- Added terminal output with base and individual status, a text-coded compatibility matrix, pair
  details, counts, classifications, and JSON/HTML/log locations. Color remains supplementary.
- Added repository-fingerprint/run-ID storage and default `latest/` copies outside the scanned
  repository. Explicit output continues to select the exact external run directory.
- Extended command capture with separate 5 MB bounded streams. Scan-time evidence is staged under
  an ownership-marked `os.tmpdir()` root and removed in the scan-level `finally` path.
- Added atomic per-file report publication, redacted and Zod-validated JSON, run-relative log
  paths, and ANSI-stripped/redacted raw evidence. Repository roots and selected worktree paths are
  removed from persisted JSON.
- Added a stricter report projection that omits repository and worktree path fields. Only this
  validated projection is serialized into HTML, with script-context escaping for `<`, `>`, `&`,
  U+2028, and U+2029.
- Added a dependency-free HTML renderer with summary cards, accessible native-button matrix,
  branch and pair evidence, expandable commands, stdout/stderr, durations, exit status,
  reproduction information, full SHAs, limitations, responsive styles, and print styles. Its CSP
  prohibits connections, external fonts, images, frames, media, and object loads.
- Updated the real demo harness to validate the HTML report and all 14 log files while preserving
  the expected scan exit `1` and harness exit `0`.

Confirmed defects and regressions:

- A regression test first showed that a valid, unbounded command ID was copied into a log filename
  and could exceed filesystem limits.
- Log filenames now retain IDs up to 64 characters and otherwise use a bounded 48-character prefix
  plus a stable 16-hex digest. The result contract and configured command ID remain unchanged.
- A real filesystem regression injected a foreign sentinel after BranchMesh created a new report
  directory and proved that recursive rollback removed it when later publication failed.
- Publication rollback now tracks its exact linked files, removes only those paths, and uses
  non-recursive empty-directory removal. Concurrent foreign files and non-empty directories are
  preserved.
- The demo harness initially compared macOS `/var` with its canonical `/private/var` target. The
  assertion now compares canonical output paths; no production path behavior was changed.

Safety and output evidence:

- Persistent output is rechecked against the repository root, common Git directory, and every
  discovered worktree. Default and latest directories are both subject to the containment check.
- Report staging has a per-run token and output identity marker, lives below `os.tmpdir()`, and is
  verified before removal. Cancellation, timeout, success, and publication-refusal tests confirm
  no matching stage remains.
- Output directory symlinks and non-directories are rejected. Publication never overwrites an
  existing run result, HTML file, or logs directory, and rollback deletes only artifacts created
  by that publication attempt.
- Hostile branch and log strings are HTML-escaped; embedded JSON prevents script termination;
  ANSI CSI/OSC controls are stripped; environment values, repository roots, execution roots, and
  selected worktree paths do not appear in published integration-test artifacts.
- The report uses no external asset, CDN, web font, analytics, framework, fetch call, or runtime
  request. It uses “No detected conflict” and contains no absolute safety claim.

Verification:

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed under strict TypeScript.
- Targeted report, publication, process cleanup, and demo tests — passed after the three regression
  corrections above.
- `npm test` — passed, 87 tests across 24 files.
- `npm run build` — passed, including declaration generation.
- `npm run demo:verify` — passed; observed scan exit `1`, three `BRANCH_PASS` jobs, one
  `BEHAVIORAL_CONFLICT` with `PAIR_TEST_FAILURE`, two `NO_DETECTED_CONFLICT` pairs, validated
  offline HTML, 14 log files, unchanged repository state, and zero temporary worktrees.
- `npm run verify` — passed end to end with the final 87-test suite, build, and demo verifier.
- A real default-path demo run produced the persistent fingerprint/run bundle and expected scan
  exit `1`; both `latest` files match their run artifacts byte-for-byte.

Remaining work and risks:

- Automated tests validate offline content, CSP, escaping, keyboard-native controls, responsive
  and print CSS, but manual browser, screen-reader, and printed-page review remains useful before
  release.
- Latest JSON and HTML are replaced atomically as individual files; simultaneous readers between
  the two replacements could briefly observe different run generations.
- This session ran on macOS. Linux and WSL remain supported by design but need their release-matrix
  executions; native Windows remains intentionally unsupported.
- Full `scan`, `init`, `doctor`, `clean`, and other CLI surfaces remain Milestone 5.

Repository actions:

- No commit, push, publication, tag, or release was performed.
- Milestone 5 was not started.

## 2026-07-17 — Milestone 5 complete CLI

- **Status:** Complete and accepted; committed as `d6017c8`.
- **Scope:** Complete and harden `init`, `doctor`, `scan`, `demo`, `clean`, and `version`; package
  and install the local CLI. No Codex skill or Milestone 6 work was added.

Codex work:

- Replaced the demo-only Commander surface with all six approved commands, command-specific help,
  usage examples, fixed CLI/config precedence, and an error boundary that reserves exit `1` for
  completed incompatibility scans. No-argument help, help flags, and short version return `0`;
  invalid commands, options, and values return `2`.
- Added no-follow repository-root configuration loading with exact JSON/Zod issue paths. CLI base,
  explicit-branch, selected-worktree, and dirty-state overrides are fully revalidated before the
  existing scan engine receives them.
- Added deterministic initialization from fixed package-script names, `packageManager`, npm,
  pnpm, yarn, and bun lockfiles, and main/master/current-branch base discovery. Initialization
  refuses ambiguous managers, missing validation scripts, symlink/non-file targets, and existing
  config without `--force`; it publishes only `branchmesh.config.json`.
- Added read-only doctor orchestration over production preflight. It validates the supported
  platform and runtime, repository/common Git identity, immutable refs, worktree dirt, submodule
  and LFS absence, statically discoverable command entry points and package scripts, and accessible
  temporary/report ancestors. It reports complex shell or relative executable checks honestly as
  deferred warnings and never executes validation commands.
- Added the real-repository `scan` command with external output normalization, terminal progress,
  final matrix/summary/paths, optional argv-only report opening, active-worktree selection, and
  preserved 0/1/2/3/4/130 behavior. The detailed version command works outside Git and reports the
  package, Node, Git, OS release, and architecture.
- Kept demo on the production engine with its expected direct exit `1`; the existing acceptance
  harness continues to return `0` only after validating classifications, reports, unchanged state,
  and cleanup.
- Added durable execution locks and per-worktree process activity transitions persisted before Git
  or validation process launch and cleared only after process-tree exit. This gives orphan recovery
  a conservative, disk-backed proof that a dead owner did not leave a known process in flight.
- Added dry-run-by-default cleanup scoped to the current canonical common Git directory. Recovery
  rejects incomplete, mismatched, symlinked, path-escaping, unexpectedly registered, live, locked,
  or non-idle roots; uses an exclusive cleanup claim; removes only exact recorded Git worktrees;
  and never calls repository-wide prune or deletes report history.
- Derived the bundled version from `package.json`, added a `dist` package allowlist and `prepack`
  build, and retained `private: true` so local archive testing cannot accidentally publish.

Regression and acceptance tests:

- Added Commander tests for the exact command list, help/version success, malformed flags/values,
  and exit-code mapping.
- Added real temporary-repository tests for config generation, no-force preservation, force
  replacement, conflicting lockfiles, root-only loading, override validation, doctor state
  preservation and dirt warnings, missing executables, production CLI scan output, and expected
  incompatibility exit `1`.
- Added orphan-clean tests for dry run, exact stale removal, idempotency, live-process retention,
  non-idle retention, corrupt evidence refusal, restored normal cleanup, and unchanged original Git
  state. The existing ownership suite now also rejects a symlinked run lock.
- Added invalid-base exit `3` coverage and OS opener tests proving explicit cwd, executable-plus-argv
  use with `shell: false`, close-awaited cancellation, failure mapping, and native-Windows refusal.

Verification:

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed under strict TypeScript.
- `npm test` — passed, 107 tests across 28 files.
- `npm run build` — passed with ESM, source map, declaration, and executable shebang.
- `npm run demo:verify` — passed; the actual demo scan returned `1` and the verifier confirmed the
  accepted branch/pair classifications, report bundle, unchanged project repository, and cleanup.
- `npm run verify` — passed end to end with the final 107-test suite.
- `npm pack --json` — passed using an isolated temporary npm cache; the archive contains four
  allowlisted entries and an executable mode for `dist/cli.js`.
- A fresh temporary-prefix install of the archive added only the package and its three runtime
  dependencies. Installed help, `--version`, and `version` returned `0`; invalid command/flag/input
  returned `2`; the installed real demo returned `1` with `BEHAVIORAL_CONFLICT` and
  `PAIR_TEST_FAILURE`.

Remaining work and risks:

- This session exercised macOS. Linux and WSL remain supported by design but still need release
  matrix runs; native Windows is deliberately rejected.
- `access()`-based doctor storage checks are read-only and cannot eliminate later disk-full,
  permission-race, or mount-state changes before a scan creates its owned roots.
- Partial execution roots created by an uncatchable crash before all ownership evidence is
  published are deliberately retained rather than guessed safe. Existing stale cleanup claims are
  likewise retained for manual inspection because ownership safety takes priority over recovery.
- Report-staging roots are independently ownership-marked and cleaned in scan `finally`, but they
  do not contain the repository identity and process-activity evidence required for `clean`; the
  command intentionally does not sweep them after `SIGKILL`.
- Optional report opening depends on the host `open` or `xdg-open` utility. Opening failure is an
  infrastructure exit `2` after the already-generated report remains available.
- Source maps intentionally embed source content in the local archive. The package remains private
  and no registry publication occurred.

Repository actions:

- The accepted implementation is recorded as `d6017c8` with message
  `feat: complete BranchMesh CLI workflow`.
- No publication, tag, or release was performed as part of that milestone.

## 2026-07-17 — Milestone 6 Codex skill and core documentation

- **Status:** Implemented and locally verified; awaiting human acceptance.
- **Scope:** Repository-scoped skill, thin deterministic workflow wrapper, shared compiled
  contracts, README, and core product documentation. No release or scanning feature work was
  added.

Codex work:

- Read the complete skill-creator guidance, its `openai.yaml` contract, repository instructions,
  full approved product plan, product/architecture contracts, decisions, milestones, build log,
  and development workflow before editing.
- Used the official skill initializer to create `.agents/skills/branchmesh` with scripts,
  references, and generated UI metadata, then replaced every placeholder with the approved
  doctor-first compatibility workflow.
- Kept the skill intentionally thin: it invokes only the local `dist/cli.js`, never contains Git
  discovery, worktree, merge, configured-command, classification, cleanup, or report-rendering
  implementations.
- Added closed runner selection modes for repeated named branches, active worktrees, or explicit
  configured selection. The runner rejects ambiguous/mixed/unbounded/comma-ambiguous refs,
  preserves refs as argv data, supports a target repository/base/output, and never exposes raw CLI
  argument pass-through.
- Runs doctor before every normal scan with the same selection policy. It rejects explicit
  `--ignore-dirty` and passes `--no-ignore-dirty` to both CLI processes, so both phases require
  clean selected worktrees even if the checked-in config enables the broader CLI opt-in.
- Added `src/contracts.ts` as a narrow tsup entry exporting only `ScanConfigSchema` and
  `RunResultSchema`. The Node 20 skill runner dynamically imports that compiled entry, opens result
  files as regular no-follow files, and uses the real strict Zod contract instead of a duplicated
  consumer schema. Both doctor and scan receive the explicit `--no-ignore-dirty` override.
- Revalidates published path redaction, null worktree paths, clean snapshots, explicit base/branch
  provenance, full SHAs, child/result exit agreement, and the JSON/HTML/log bundle. Its stdout is a
  bounded JSON envelope with retained report paths, job evidence, and short redacted failed-command
  excerpts; potentially large log text remains in the exact redacted result for deliberate
  inspection.
- Preserves actual completed scan exit `0`, `1`, or result-bearing `3` in `scanExitCode` while the
  wrapper returns `0` after successful revalidation. Missing result evidence fails closed as
  infrastructure error. SIGINT/SIGTERM are forwarded to the active child, interruption is checked
  at every wrapper-owned validation/publication boundary, and cleanup is awaited.
- Added a deterministic skill-demo verifier that expects the production demo's real exit `1`,
  checks all accepted classifications plus unchanged-state/zero-worktree evidence, and removes
  only its token-marked exact temporary verification root after canonical containment and marker
  validation.
- Added README and dedicated architecture, safety, configuration, CLI, classification, supported
  platform, limitations, troubleshooting, and judge-testing guides. Documentation states shipped
  behavior only, distinguishes harness/direct-demo exits, and leaves license/release artifacts as
  explicit final-release work.
- Reconciled the accepted Milestone 5 commit in the milestone/build histories and recorded the
  skill execution/trust decisions in `DECISIONS.md`.

Skill safety and interpretation behavior:

- Trigger metadata covers active Git/Codex/agent worktrees, parallel branches, branch
  compatibility, and hidden integration failures while excluding ordinary single-branch tests,
  remote PR analysis, uncommitted snapshots, and automatic fixes.
- The workflow resolves ambiguity before selection, retains the configured base unless the user
  names one, refuses dirt/ownership workarounds, never invokes init/clean/open/installers, and never
  downloads a substitute CLI.
- Branch names, changed files, configured commands, and logs are explicitly untrusted evidence.
  Prompt-like log content is quoted, not followed. The skill never uploads artifacts, browses for
  explanations, calls an external service, or modifies code without a separate user request.
- Explanations include base and branch names/full SHAs, individual and pair classifications, merge
  order, failed command/exit/timeout/duration, concise redacted evidence, conflicted files,
  truncation state, and JSON/HTML locations.
- Passing pairs use “No detected conflict under the configured commands” and always state the
  committed-tip/configured-command/pairwise/single-order limitations.

Tests and forward validation:

- Added skill discovery tests for required resource paths, exact minimal frontmatter keys, trigger
  terms, generated UI metadata, safety language, reference taxonomy, and removal of initializer
  placeholders.
- Added syntax/static process-boundary tests proving the wrapper uses the local CLI/contracts,
  `spawn` with `shell: false`, and no fetch/http/net/dns/curl/wget/npx, internal merge, or worktree
  implementation.
- Added runner tests for exact selection mode, 2–5 named refs, duplicates, base overlap,
  comma-ambiguous refs, hostile ref preservation, explicit dirt-bypass refusal, and bounded
  envelopes containing full refs/SHAs, classifications, failed command, retained report paths, and
  capped redacted evidence excerpts.
- A final-review regression first failed because the wrapper's one-time config rejection left a
  race: the config could enable `ignoreDirty` after doctor and before scan. Added a paired
  Commander `--no-ignore-dirty` override and made the wrapper pass it to both processes. The
  default/positive CLI behavior is unchanged, and the regression proves the safety override is
  available and used.
- Added documentation tests that check every required guide, local README links, absence of
  personal paths/placeholders, JSON examples against `ScanConfigSchema`, and every stable
  classification against the production enum schemas.
- An independent fresh-context Codex forward test followed the skill and ran the deterministic
  demo. It correctly explained `BASE_PASS`, three full-SHA `BRANCH_PASS` jobs, one clean-merge
  `BEHAVIORAL_CONFLICT` with `PAIR_TEST_FAILURE`, the failed `node --test` assertion, two “No
  detected conflict” pairs, zero skips/conflicted files, report locations, and limitations without
  modifying source. Its isolated report directory was verified and removed afterward.
- The skill-creator `quick_validate.py` helper was invoked, but the host Python stopped before
  reading the skill because its `yaml` import is unavailable. No package or host dependency was
  installed. Repository discovery-layout/frontmatter tests cover the helper's structural checks,
  and a path-directed independent forward invocation passed; actual host discovery and the official
  helper with PyYAML remain release-time checks.

Verification:

- `npm run format:check` — passed across the repository and protected skill files.
- `npm run lint` — passed with zero warnings, including the skill's `.mjs` wrapper.
- `npm run typecheck` — passed under strict TypeScript.
- `npm test` — passed, 116 tests across 30 files.
- `npm run build` — passed with executable CLI output plus the shared contracts ESM/declaration
  entry.
- `npm run demo:verify` — passed; actual scan exit `1`, accepted hidden conflict, validated offline
  report/logs, unchanged project repository, and zero temporary worktrees.
- `npm run skill:verify` — passed; actual scan exit `1` was preserved in a schema-validated bounded
  envelope with every full demo SHA/classification and the ephemeral owned report was removed.
- `npm run verify` — passed end to end with both demo verifiers.

Remaining work and risks:

- Linux and WSL release-matrix runs remain pending; this session ran on macOS. Native Windows,
  submodules, and Git LFS remain intentionally unsupported.
- The normal wrapper reads the exact absolute `JSON:` path emitted by its own trusted human scan
  summary when no explicit output is supplied; it never reads `latest`. A future machine-readable
  scan envelope could remove this small presentation coupling without changing scan behavior.
- The skill is repository-scoped and present in a Git checkout; the package allowlist still ships
  only compiled `dist`, so linking/installing the CLI alone does not install the skill elsewhere.
- Manual browser/screen-reader/print review, release archives/prebuilt output, sample reports,
  screenshots, public URLs, license selection, Linux/WSL runs, and submission evidence remain
  Milestone 7.

Repository actions:

- No commit, push, publication, tag, or release was performed for Milestone 6.
- Milestone 7 was not started.
