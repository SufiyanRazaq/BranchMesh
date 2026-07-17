# BranchMesh

> Git catches line conflicts. BranchMesh catches branches that merge cleanly but break each other.

BranchMesh is a local-first TypeScript CLI and repository-scoped Codex skill. It snapshots
committed branch tips, combines them in isolated temporary Git worktrees, runs repository-defined
checks, and publishes validated JSON plus a self-contained offline HTML compatibility report.
BranchMesh reports observed evidence only; a passing pair means **No detected conflict** under the
configured commands.

## Compatibility matrix

The deterministic demo produces this relationship:

```text
                         config-seconds        jitter             status-output
config-seconds                  —         Behavioral conflict   No detected conflict
jitter                Behavioral conflict            —          No detected conflict
status-output         No detected conflict   No detected conflict           —
```

The HTML report turns the matrix into keyboard-accessible controls with branch, pair, command, and
redacted log evidence. A checked-in screenshot and sample report are intentionally deferred to the
release milestone.

## Hidden-conflict example

The demo creates three independently passing branches. `feature/config-seconds` renames a retry
configuration property while `feature/jitter` starts consuming the old property. Git merges the
branches without a textual conflict, but their combined Node test fails. BranchMesh records:

```text
feature/config-seconds alone: BRANCH_PASS
feature/jitter alone:         BRANCH_PASS
combined:                     BEHAVIORAL_CONFLICT
technical classification:    PAIR_TEST_FAILURE
```

`feature/status-output` remains compatible with both branches.

## Quick demo

```bash
npm ci
npm run build
npm run demo
```

`npm run demo` is the acceptance harness: it runs the real CLI, expects the scan itself to detect
an incompatibility with exit `1`, validates the JSON/HTML/log bundle and cleanup, then returns `0`.

For the visual CLI and retained report, use a fresh external output directory:

```bash
node dist/cli.js demo --output /tmp/branchmesh-demo-report --open
```

That direct demo command intentionally exits `1` after publishing the expected behavioral
conflict.

## Installation

BranchMesh currently ships from source and is not published to a registry:

```bash
# Start from the BranchMesh checkout supplied with the submission.
cd BranchMesh
npm ci
npm run build
npm link
```

Node.js 20+ and Git 2.31+ are required. `npm pack` can produce a local private archive for testing,
but release archives and prebuilt output belong to the final release milestone.

## Real-repository usage

From a local JavaScript or TypeScript Git repository:

```bash
branchmesh init
# Inspect branchmesh.config.json before running project commands.
branchmesh doctor --base main --branches feature/a,feature/b
branchmesh scan --base main --branches feature/a,feature/b --open
```

For branches already checked out in active worktrees:

```bash
branchmesh doctor --worktrees
branchmesh scan --worktrees
```

`init` is the only BranchMesh command that writes into the current repository. Every other command
keeps execution and report files outside the scanned worktree.

## Configuration

BranchMesh reads one strict `branchmesh.config.json` from the canonical repository root. It
contains a base, an explicit branch list or worktree-selection policy, optional setup, one or more
ordered validation commands, and bounded execution settings.

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

Configured command strings are the only shell boundary. Review them before scanning: they are
ordinary project commands and may install dependencies or use the network even though BranchMesh
itself makes no runtime HTTP request. See [Configuration](docs/CONFIGURATION.md).

## How BranchMesh works

1. Read and Zod-validate the root configuration.
2. Run repository preflight and snapshot the base plus every selected branch to a full immutable
   commit ID.
3. Validate the base in a fresh detached worktree.
4. Validate every `base + branch` integration in its own fresh worktree.
5. Validate every eligible canonical pair; represent pairs containing an individually failing
   branch as `PAIR_SKIPPED`.
6. Preserve deterministic result order even with concurrency two.
7. Validate, redact, and atomically publish JSON, raw logs, and one offline HTML file.
8. Ownership-check and clean each temporary worktree in `finally` paths.

See [Architecture](docs/ARCHITECTURE.md).

## Classification meanings

Every job has one primary classification. A pair that fails after both branches passed uses
`BEHAVIORAL_CONFLICT` as its primary cause and adds a technical classification such as
`PAIR_TEST_FAILURE` or `PAIR_BUILD_FAILURE`. Git merge failure is `TEXTUAL_CONFLICT`; an unexecuted
pair is `PAIR_SKIPPED`.

See the complete [Classification reference](docs/CLASSIFICATIONS.md).

## Safety guarantees

BranchMesh guarantees its own operational boundaries, not the absence of software defects:

- no merge, checkout, reset, clean, stash, or rebase in a user worktree;
- captured commit IDs for all jobs;
- detached execution worktrees below an ownership-marked `os.tmpdir()` root;
- argv arrays and `shell: false` for internal Git and operating-system commands;
- dirty selected worktrees rejected by default;
- conservative, ownership-verified cleanup without repository-wide pruning;
- reports stored outside the scanned repository, with repository/common-Git paths removed,
  selected worktree paths nulled, and no environment map serialized.

Published evidence can still contain sensitive branch names, file names, configured command text,
and command output. The redactor removes ANSI controls plus recognized sensitive or sufficiently
long inherited environment values, but a short non-sensitive value echoed by a command is
indistinguishable from ordinary output. Review reports before sharing. See
[Safety model](docs/SAFETY_MODEL.md).

## Codex skill usage

The repository skill is discovered from `.agents/skills/branchmesh` while Codex is working in this
checkout. Example requests:

```text
Use $branchmesh to check my active worktrees.
Use $branchmesh to check feature/config and feature/jitter against main.
```

The skill resolves ambiguity, runs doctor first, invokes the deterministic local CLI, revalidates
the exact result with the compiled Zod contract, and explains classifications and evidence. It
never bypasses dirt or ownership checks and does not implement a fix unless the user makes a
separate request. The wrapper accepts `--repository` when this checkout's skill is used to inspect
another local repository; an npm-linked CLI alone does not install the repository skill there.

## How GPT-5.6 and Codex were used

Codex implemented the architecture, Git/process safety paths, fixtures, tests, report, CLI, skill,
and documentation under human-approved milestone boundaries. Human decisions, verification, and
commit evidence are separated in [CODEX_BUILD_LOG.md](CODEX_BUILD_LOG.md) and
[DECISIONS.md](DECISIONS.md). No runtime model call is part of BranchMesh. The checked-in evidence
does not independently establish the backing Codex model version, so GPT-5.6-specific attribution
remains a release-time factual check rather than an unsupported claim.

## Supported platforms

- macOS: supported and exercised in the current development session.
- Linux: supported by the runtime gate and POSIX process model; release-matrix execution remains
  pending.
- WSL: supported as Linux; release-matrix execution remains pending.
- Native Windows: rejected for the MVP.

Git submodules and Git LFS repositories are rejected until their lifecycle behavior is explicitly
tested. Optional `--open` requires `open` on macOS or `xdg-open` on Linux/WSL. See
[Supported platforms](docs/SUPPORTED_PLATFORMS.md).

## Current limitations

BranchMesh scans committed tips only, requires two to five selected branches, tests pairwise
combinations in one deterministic merge order, stops after an invalid base, and observes only the
configured commands. It does not cache results, test reverse order or higher-order combinations,
snapshot uncommitted content, integrate with GitHub, call an AI service, or apply fixes.

See [Limitations](docs/LIMITATIONS.md).

## Judge testing

The fastest verification is:

```bash
npm ci
npm run verify
```

The suite includes formatting, linting, strict type-checking, real temporary Git repositories,
build, the deterministic demo, and the Codex skill demo. See [Judge testing](docs/JUDGE_TESTING.md)
for the visual path, expected exit codes, another-repository workflow, and state-preservation
checks.

## Architecture

BranchMesh is one Node.js package with strict dependency boundaries across CLI orchestration,
configuration, Git inspection, execution, result contracts, report publication, and the thin
repository skill. There is no backend, database, telemetry, frontend framework, or runtime network
client. See [Architecture](docs/ARCHITECTURE.md).

## Development-period documentation

- [Product contract](docs/PRODUCT_SPEC.md)
- [Complete approved product plan](docs/BRANCHMESH_PRODUCT_PLAN.md)
- [Milestones](docs/MILESTONES.md)
- [Codex development workflow](docs/CODEX_DEVELOPMENT_WORKFLOW.md)
- [Build log](CODEX_BUILD_LOG.md)
- [Decision log](DECISIONS.md)
- [CLI reference](docs/CLI_REFERENCE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

No open-source license has been selected yet. Until the repository owner adds one, no license is
granted; selecting and adding the intended license remains a final-release decision.
