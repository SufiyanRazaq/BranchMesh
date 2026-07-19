# BranchMesh

> Git catches line conflicts. BranchMesh catches branches that merge cleanly but break each other.

BranchMesh is a local-first TypeScript CLI and repository-scoped Codex skill for committed Git
branches. It snapshots immutable commit IDs, evaluates the base, each branch, and every branch pair
inside isolated detached worktrees, then publishes terminal output, strict JSON, separate logs, and
one self-contained offline HTML report. A passing relationship means **No detected conflict under
the configured commands**.

## Fastest judge path

From the repository root with Node.js 20+ and Git 2.31+:

```bash
npm ci
npm run demo
```

`npm run demo` builds and runs the real production scanner against a deterministic three-branch
fixture. The scan itself detects one incompatibility and exits `1`; the acceptance harness checks
that expected result, validates the JSON/HTML/log bundle and cleanup, and returns `0`.

Expected final lines:

```text
Actual scan exit code: 1 (expected incompatibility)
Base: BASE_PASS
Branches: BRANCH_PASS, BRANCH_PASS, BRANCH_PASS
Pairs: 1 BEHAVIORAL_CONFLICT (PAIR_TEST_FAILURE), 2 NO_DETECTED_CONFLICT
Temporary worktrees remaining: 0
Project repository unchanged: yes
```

## Compatibility matrix

The deterministic demo produces:

```text
                         config-seconds        jitter             status-output
config-seconds                  —         Behavioral conflict   No detected conflict
jitter                Behavioral conflict            —          No detected conflict
status-output         No detected conflict   No detected conflict           —
```

The real generated artifacts are checked in for review:

- [validated demo result JSON](docs/samples/demo-result.json)
- [self-contained offline demo report](docs/samples/demo-report.html)

Download or clone the repository and open the HTML file locally to use its keyboard-accessible
matrix and evidence drawer. The sample is revalidated by `npm run report:verify`.

## Hidden-conflict example

The demo creates three independently passing branches. `feature/config-seconds` renames a retry
configuration property while `feature/jitter` consumes the old property. Git combines them
without a textual conflict, but their combined Node test fails:

```text
feature/config-seconds alone: BRANCH_PASS
feature/jitter alone:         BRANCH_PASS
combined:                     BEHAVIORAL_CONFLICT
technical classification:    PAIR_TEST_FAILURE
Git conflicted files:         none
```

`feature/status-output` remains compatible with both branches.

## Installation

Prerequisites:

- macOS, Linux, or WSL;
- Node.js 20 or newer;
- Git 2.31 or newer;
- npm, supplied with Node.js.

### From source

```bash
git clone https://github.com/SufiyanRazaq/BranchMesh.git
cd BranchMesh
npm ci
npm run build
```

The repository URL must be made accessible to judges before submission. If the source is supplied
as an archive instead, extract it, enter its root, and run the same `npm ci` and build commands.

For a temporary command available while testing other repositories:

```bash
npm link
branchmesh --help
```

### From a local package archive

BranchMesh is not published to npm. Create and install a local archive without publishing:

```bash
mkdir -p /tmp/branchmesh-pack /tmp/branchmesh-install
npm pack --cache /tmp/branchmesh-npm-cache --pack-destination /tmp/branchmesh-pack
npm install --cache /tmp/branchmesh-npm-cache --prefix /tmp/branchmesh-install /tmp/branchmesh-pack/branchmesh-0.1.0.tgz
/tmp/branchmesh-install/node_modules/.bin/branchmesh --help
```

The archive contains the MIT License, README, package metadata, and compiled `dist` output. The
repository-scoped Codex skill remains in this checkout and is not installed by the CLI archive.

## Real-repository usage

From a local JavaScript or TypeScript Git repository:

```bash
branchmesh init
# Review branchmesh.config.json before running any configured command.
branchmesh doctor --base main --branches feature/a,feature/b
branchmesh scan --base main --branches feature/a,feature/b
```

For branches already checked out in active worktrees:

```bash
branchmesh doctor --worktrees
branchmesh scan --worktrees
```

`init` is the only BranchMesh command that writes into the current repository. Every scan
execution root and default report location remains outside the scanned worktree. Use `--open`
only when a supported local opener is available; it is optional and is omitted from headless judge
commands.

## Configuration

BranchMesh reads one strict `branchmesh.config.json` from the canonical repository root:

```json
{
  "base": "main",
  "branches": {
    "source": "worktrees",
    "include": ["feature/*", "codex/*"],
    "exclude": ["main"]
  },
  "setup": {
    "command": "npm ci --prefer-offline",
    "timeoutMs": 300000
  },
  "commands": [
    {
      "id": "test",
      "label": "Tests",
      "kind": "test",
      "command": "npm test",
      "timeoutMs": 120000
    }
  ],
  "execution": {
    "maxBranches": 5,
    "concurrency": 2,
    "failFast": false,
    "skipPairsWithFailedBranches": true,
    "ignoreDirty": false,
    "maximumLogBytes": 200000
  }
}
```

Configured setup and validation strings are the only shell boundary. Review them before scanning:
they are ordinary project commands and may install dependencies or use the network even though
BranchMesh itself has no runtime HTTP or model client. See the
[configuration reference](docs/CONFIGURATION.md).

## How BranchMesh works

1. Resolve the repository/common Git directory and Zod-validate the configuration.
2. Reject unsupported repository state and dirty selected worktrees by default.
3. Snapshot the base and every selected branch to full immutable commit IDs.
4. Validate the base in a fresh detached worktree; stop if it is invalid.
5. Validate each `base + branch` integration in its own fresh worktree.
6. Validate every eligible canonical pair; record `PAIR_SKIPPED` for pairs containing a failing
   individual branch.
7. Preserve deterministic stored order with bounded concurrency of one or two.
8. Validate, redact, and atomically publish JSON, raw logs, and the offline HTML report.
9. Ownership-check and remove each temporary worktree in `finally` paths.

See the [architecture](docs/ARCHITECTURE.md).

## Classification meanings

Every job has one primary classification. A pair that fails a configured command after both
branches passed uses `BEHAVIORAL_CONFLICT` and adds a technical classification such as
`PAIR_TEST_FAILURE` or `PAIR_BUILD_FAILURE`. A Git merge failure is `TEXTUAL_CONFLICT`; an
unexecuted planned pair is `PAIR_SKIPPED`.

See the complete [classification reference](docs/CLASSIFICATIONS.md).

## Safety model

BranchMesh is designed to enforce these operational boundaries; it does not establish the absence
of software defects:

- no merge, checkout, reset, clean, stash, or rebase in a user worktree;
- full captured commit IDs for all jobs;
- detached execution worktrees beneath a private ownership-marked `os.tmpdir()` root;
- argv arrays and `shell: false` for internal Git and operating-system commands;
- dirty selected worktrees rejected by default;
- disabled hooks, signing, rerere, automatic maintenance, and garbage collection for synthetic
  merges;
- process-group termination and verified supervisor closure before worktree removal;
- conservative ownership/containment-verified cleanup without repository-wide pruning;
- reports stored outside the scanned repository with local roots removed and no environment map
  serialized.

Reports intentionally retain branch names, file names, command text, commit IDs, and bounded
command output. Review them before sharing. Configured commands are trusted project programs and
must not deliberately daemonize into another process group. See the
[safety model](docs/SAFETY_MODEL.md).

## Codex skill usage

The repository skill is discovered from `.agents/skills/branchmesh` while Codex is working in
this checkout. Example requests:

```text
Use $branchmesh to check my active worktrees.
Use $branchmesh to check feature/config and feature/jitter against main.
```

The skill resolves branch ambiguity, runs doctor first, invokes the same deterministic local CLI,
revalidates the exact `result.json` with the compiled Zod contract, and explains classifications
and evidence. It never bypasses dirty-worktree or ownership checks, uploads source, calls an
external service, or implements a fix without a separate request. Automated tests validate its
layout and wrapper; actual host discovery remains a manual submission check.

## How Codex and GPT-5.6 were used

Codex was the primary engineering collaborator for architecture, implementation, temporary Git
fixtures, adversarial safety tests, report and CLI design, the repository skill, documentation,
and repeated review. Humans locked the scope and safety decisions, reviewed findings, required
regression-first fixes, approved milestones, and controlled commits. Evidence is recorded in the
[build log](CODEX_BUILD_LOG.md), [decision log](DECISIONS.md), and dated Git history.

The approved development workflow selected GPT-5.6 Sol Ultra, but this repository cannot by itself
prove which backing model served the primary Codex session. The submission owner must confirm the
session metadata before making a GPT-5.6-specific attribution. BranchMesh itself makes no runtime
model or API call. Exact verified and fallback submission wording is in the
[submission draft](docs/SUBMISSION.md).

## Supported platforms

| Environment    | Status                           |
| -------------- | -------------------------------- |
| macOS          | Supported and exercised locally  |
| Linux          | Supported by implementation      |
| WSL            | Supported through the Linux path |
| Native Windows | Unsupported and rejected for MVP |

Linux and WSL release-matrix runs are still pending; no claim is made that this development session
executed them. Git submodules and Git LFS repositories are rejected until their lifecycle behavior
is explicitly tested. Optional report opening requires `open` on macOS or `xdg-open` on
Linux/WSL. See [supported platforms](docs/SUPPORTED_PLATFORMS.md).

## Known limitations

BranchMesh scans committed tips only, requires two to five selected branches, tests pairwise
combinations in one deterministic merge order, and observes only configured commands. It does not
cache results, test reverse order or higher-order combinations, snapshot uncommitted content,
integrate with GitHub, call an AI service, or apply fixes. `SIGKILL` and power loss cannot run
in-process cleanup; deliberately daemonized configured-command descendants can escape the managed
process group; and `branchmesh clean` recovers only roots with complete ownership evidence.

See [known limitations](docs/LIMITATIONS.md).

## Complete judge verification

The single complete command is:

```bash
npm ci
npm run verify
```

For individually visible gates:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run demo:verify
npm run report:verify
npm run skill:verify
npm pack --cache /tmp/branchmesh-npm-cache --pack-destination /tmp/branchmesh-pack
```

The unit and integration scripts intentionally overlap with `npm test`; they exist so a reviewer
can inspect each gate independently. See [judge testing](docs/JUDGE_TESTING.md) for expected exit
codes, a retained visual-report path, packed-install smoke testing, and original-worktree
preservation checks.

## Architecture summary

BranchMesh is one Node.js package with strict boundaries across CLI orchestration, configuration,
Git inspection, execution/classification, runtime result contracts, report publication, and the
thin repository skill. Zod schemas are the runtime source of truth. There is no backend, database,
account system, telemetry, frontend framework, GitHub API client, or runtime network/model client.
See [architecture](docs/ARCHITECTURE.md).

## Submission materials

- [Devpost copy and technical narrative](docs/SUBMISSION.md)
- [three-minute video script](docs/VIDEO_SCRIPT.md)
- [screenshot capture checklist](docs/SCREENSHOT_CHECKLIST.md)
- [demo-recording checklist](docs/DEMO_RECORDING_CHECKLIST.md)
- [release checklist](docs/RELEASE_CHECKLIST.md)
- [validated sample result](docs/samples/demo-result.json)
- [offline sample report](docs/samples/demo-report.html)

## Development documentation

- [Product contract](docs/PRODUCT_SPEC.md)
- [Complete approved product plan](docs/BRANCHMESH_PRODUCT_PLAN.md)
- [Milestones](docs/MILESTONES.md)
- [Codex development workflow](docs/CODEX_DEVELOPMENT_WORKFLOW.md)
- [Build log](CODEX_BUILD_LOG.md)
- [Decision log](DECISIONS.md)
- [CLI reference](docs/CLI_REFERENCE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

BranchMesh is available under the [MIT License](LICENSE).

Copyright (c) 2026 Sufiyan Razaq.
