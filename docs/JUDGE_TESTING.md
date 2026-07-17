# Judge testing guide

This guide separates a success-returning automated verification from the product's intentional
nonzero conflict signal.

## Fastest complete verification

From a fresh clone:

```bash
npm ci
npm run verify
```

Expected outcome:

- formatting, linting, strict TypeScript, unit/integration tests, and build pass;
- the real demo scan exits `1` for its expected incompatibility;
- the verification harness exits `0` after checking one `BEHAVIORAL_CONFLICT` with
  `PAIR_TEST_FAILURE`, two `NO_DETECTED_CONFLICT` pairs, offline HTML, raw logs, unchanged project
  state, and zero remaining temporary worktrees;
- the repository skill's discovery layout and metadata contracts pass, and its demo wrapper
  revalidates the deterministic result with the compiled Zod schema.

`npm run demo` is a shorter success-returning demo verifier.

## Visual deterministic demo

```bash
npm run build
node dist/cli.js demo --output /tmp/branchmesh-judge-demo --open
```

The direct CLI should publish a report and exit `1`. That exit is the successful detection signal,
not a crash. Expected evidence:

```text
Base:                         BASE_PASS
feature/config-seconds:       BRANCH_PASS
feature/jitter:               BRANCH_PASS
feature/status-output:        BRANCH_PASS
config-seconds + jitter:      BEHAVIORAL_CONFLICT / PAIR_TEST_FAILURE
config-seconds + status:      NO_DETECTED_CONFLICT
jitter + status:              NO_DETECTED_CONFLICT
Textual conflicts:            0
```

If `/tmp/branchmesh-judge-demo` already contains report artifacts, choose a fresh external path.
Omit `--open` in a headless environment and use the printed HTML path.

## Exercise the Codex skill

Open Codex in the BranchMesh checkout so `.agents/skills/branchmesh` is discovered, then ask:

```text
Use $branchmesh to run the deterministic demo and explain the evidence.
```

This manual exercise—not `npm run verify`—confirms that the current Codex host actually discovers
and invokes the repository skill. The automated suite validates the expected discovery layout,
metadata, references, and wrapper behavior.

The skill's acceptance command is:

```bash
npm run skill:verify
```

It runs the production demo, expects actual scan exit `1`, validates the exact published JSON with
`dist/contracts.js`, checks all branch/pair classifications and cleanup evidence, emits a bounded
JSON envelope, and removes only its ownership-marked temporary acceptance report.

For a real request, the skill runs doctor before scan, resolves one explicit selection mode,
rejects the `--ignore-dirty` argument, forces clean selected-worktree checks even when config says
otherwise, and reports branch names, full captured SHAs, failed command, evidence, and report
location. It must use “No detected conflict” and must not implement a fix unless separately
requested.

## Test another local repository

Build and link the CLI from the BranchMesh checkout:

```bash
npm run build
npm link
```

Then, in a JavaScript/TypeScript repository with at least two local feature branches:

```bash
cd /path/to/project
branchmesh init
# Review branchmesh.config.json and its command strings.
branchmesh doctor --base main --branches feature/a,feature/b
branchmesh scan --base main --branches feature/a,feature/b --open
```

`init` is the only command above that writes into the target repository. To avoid it, create and
review a valid root config manually before doctor. The packed/linked CLI does not install the
repository-scoped skill into the target project; from the BranchMesh checkout, the skill wrapper
can target it with `--repository`.

## Verify original repository preservation

Before and after a scan, compare:

```bash
git rev-parse HEAD
git symbolic-ref --short -q HEAD
git status --porcelain=v1 --untracked-files=all
git worktree list --porcelain
```

The branch, HEAD, status, and pre-existing worktree registrations must be unchanged. The automated
safety suite additionally compares raw index bytes, every ref, tracked/untracked contents, and Git
worktree administrative records.

## Inspect generated evidence

The terminal summary prints exact paths:

```text
JSON: <external-run>/result.json
HTML: <external-run>/report.html
Raw logs: <external-run>/logs
```

Disconnect networking and open `report.html`; it uses no CDN, font, image, analytics, fetch call,
or runtime request. Inspect a behavioral pair and verify both individual jobs passed, the pair
failed, Git conflict files are empty, the technical classification matches the failed command, and
the full SHAs are visible.

## Exit-code expectations

|  Exit | Expected interpretation                                       |
| ----: | ------------------------------------------------------------- |
|   `0` | All executed validations passed                               |
|   `1` | Completed scan found a branch/pair incompatibility            |
|   `2` | Configuration/infrastructure/ownership/report/cleanup failure |
|   `3` | Invalid or failing base                                       |
|   `4` | Dirty or unsupported repository state                         |
| `130` | Interrupted                                                   |

## Platform evidence

The current development session ran on macOS. Linux and WSL are supported by implementation but
still need release-matrix executions. Native Windows is deliberately rejected. Submodule and Git
LFS repositories are also rejected.

## Release-state honesty

This milestone does not claim checked-in prebuilt `dist`, a release `.tgz`, a sample report,
screenshots, a public repository URL, or a selected license. Those remain final-release tasks; use
the source build and deterministic generator above for current judging.
