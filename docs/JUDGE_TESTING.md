# Judge testing guide

This guide separates the success-returning acceptance harness from the product's intentional
nonzero conflict signal.

## Fastest demonstration

From the repository root:

```bash
npm ci
npm run demo
```

`npm run demo` builds the production CLI, creates a deterministic temporary Git repository, runs
the real scanner, and removes the fixture. The underlying scan exits `1` because it finds an
incompatibility; the verification harness confirms that expected outcome and returns `0`.

Expected evidence:

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

## Full source verification

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run demo:verify
npm run report:verify
npm run skill:verify
```

`npm run verify` runs the equivalent aggregate gate, with `npm test` covering both unit and
integration suites. The demo verifier also checks unchanged BranchMesh repository state, validated
JSON/HTML/log output, expected classifications, and zero remaining temporary worktrees.

## Retain and inspect a real report

Choose a fresh external directory and omit `--open` for a headless-safe command:

```bash
npm run build
node dist/cli.js demo --output /tmp/branchmesh-judge-demo
```

The direct CLI publishes its bundle and exits `1`. That is the successful detection signal, not a
crash. Open the printed `report.html` path manually. If the directory already contains report
artifacts, choose another fresh path.

Inspect:

- three independently passing branches;
- one pair with `BEHAVIORAL_CONFLICT` and `PAIR_TEST_FAILURE`;
- an empty conflicted-files list for that behavioral pair;
- two pairs labeled “No detected conflict”;
- full snapshotted SHAs, merge order, command, exit status, duration, and bounded output;
- the limitations panel.

A generated and revalidated example is available at
[samples/demo-report.html](samples/demo-report.html), with its strict result at
[samples/demo-result.json](samples/demo-result.json).

## Offline-report validation

```bash
npm run report:verify
```

This parses the sample JSON with `RunResultSchema`, parses the HTML's embedded projection with
`ReportProjectionSchema`, checks the accepted classifications, and rejects personal absolute
paths, external HTTP assets, fetch calls, unsafe claims, or extra script boundaries. The production
renderer's hostile-text tests separately cover HTML, `</script>`, Unicode, and ANSI evidence.

## Create and test the local package archive

No publication is required:

```bash
mkdir -p /tmp/branchmesh-pack /tmp/branchmesh-install
npm pack --cache /tmp/branchmesh-npm-cache --pack-destination /tmp/branchmesh-pack
npm install --cache /tmp/branchmesh-npm-cache --prefix /tmp/branchmesh-install /tmp/branchmesh-pack/branchmesh-0.1.0.tgz
/tmp/branchmesh-install/node_modules/.bin/branchmesh --help
/tmp/branchmesh-install/node_modules/.bin/branchmesh version
```

For the packed real demo:

```bash
/tmp/branchmesh-install/node_modules/.bin/branchmesh demo --output /tmp/branchmesh-packed-demo
```

That final command must exit `1` and report the same deterministic incompatibility. Use fresh
directories when repeating it.

## Exercise the Codex skill

Open Codex in the BranchMesh checkout so `.agents/skills/branchmesh` can be discovered, then ask:

```text
Use $branchmesh to run the deterministic demo and explain the evidence.
```

This manual exercise confirms actual host discovery. The automated wrapper gate is:

```bash
npm run skill:verify
```

It runs the production demo, preserves actual scan exit `1` in its validated envelope, checks the
expected full SHAs/classifications and cleanup evidence, then removes only its ownership-marked
temporary acceptance report.

For a normal repository request the skill resolves one explicit selection mode, runs doctor before
scan, forces clean selected-worktree checks, and reports branch names, captured SHAs, failed
command, concise evidence, and report location. It does not implement a fix unless separately
requested.

## Test another local repository

Build and link from this checkout:

```bash
npm run build
npm link
```

Then, in a local JavaScript or TypeScript repository with at least two committed feature branches:

```bash
cd /path/to/project
branchmesh init
# Review branchmesh.config.json and every configured command.
branchmesh doctor --base main --branches feature/a,feature/b
branchmesh scan --base main --branches feature/a,feature/b
```

`init` is the only command above that writes into the target repository. The linked/packed CLI
does not install the repository-scoped skill into that project.

## Verify original repository preservation

Before and after a scan, compare:

```bash
git rev-parse HEAD
git symbolic-ref --short -q HEAD
git status --porcelain=v1 --untracked-files=all
git worktree list --porcelain
```

The branch, HEAD, status, and pre-existing worktree registrations must be unchanged. Automated
safety tests additionally compare raw index bytes, all refs, tracked/untracked contents, and Git
worktree administrative records.

## Exit-code expectations

|  Exit | Interpretation                                                |
| ----: | ------------------------------------------------------------- |
|   `0` | Every executed validation passed                              |
|   `1` | Completed scan found a branch/pair incompatibility            |
|   `2` | Configuration/infrastructure/ownership/report/cleanup failure |
|   `3` | Invalid or failing base                                       |
|   `4` | Dirty or unsupported repository state                         |
| `130` | Interrupted                                                   |

## Platform and claim boundaries

The current development and release verification session ran on macOS. Linux and WSL are supported
by implementation but still need release-matrix execution. Native Windows, submodule repositories,
and Git LFS repositories are deliberately rejected.

BranchMesh has no runtime HTTP/model client. User-configured project commands are ordinary shell
commands and may access the network. The checked-in report is real demo output; screenshots, public
links, actual Codex host discovery, model-version attribution, and manual browser/accessibility
review remain human submission gates.
