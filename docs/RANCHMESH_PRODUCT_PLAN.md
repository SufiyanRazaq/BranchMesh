# BranchMesh — Complete Development Plan

## 1. Product definition

**Category:** Developer Tools
**Product name:** BranchMesh
**Tagline:** *Git catches line conflicts. BranchMesh catches branches that merge cleanly but break each other.*

**One-sentence pitch:**

> BranchMesh is a local-first Codex skill and CLI that combines parallel Git branches inside isolated temporary worktrees, runs the project’s checks, and produces a visual compatibility matrix showing which branches break when merged together.

### Target user

Developers using:

* Codex worktrees;
* multiple coding agents;
* parallel feature branches;
* multiple contributors working simultaneously;
* repositories where branches often pass individually but fail after integration.

### Core promise

BranchMesh answers:

> “All my agents say their branches pass. Which branches are actually safe to combine?”

### Product boundary

BranchMesh does **not** prove that code is bug-free. It proves only that:

* the selected branches merged successfully;
* the configured build, test, lint, and type-check commands passed;
* no incompatibility was detected by those commands.

Use the phrase **“No detected conflict”**, not **“Guaranteed safe.”**

---

# 2. Build it as two connected products

## Layer A: Deterministic local engine

This is the real technical product.

It:

* discovers branches and worktrees;
* creates isolated temporary worktrees;
* combines branch commits;
* runs configured commands;
* classifies failures;
* generates JSON and HTML reports;
* makes no model calls;
* makes no external API calls;
* uploads no source code;
* requires no account or cloud backend.

## Layer B: Codex skill

The skill lets a developer ask Codex:

> “Use BranchMesh to check my active worktrees.”

Codex then:

1. verifies the environment;
2. runs the deterministic BranchMesh engine;
3. reads the generated structured report;
4. explains the incompatibility;
5. optionally proposes or implements a fix when the user asks.

This is the best way to satisfy your no-API constraint while still making Codex and GPT-5.6 central to the experience. Codex skills consist of a required `SKILL.md` plus optional scripts, references, assets, and UI metadata. Repository skills can be stored under `.agents/skills`, and skills work across the Codex CLI, IDE extension, and ChatGPT desktop app. ([OpenAI Developers][1])

---

# 3. Locked MVP scope

The most important discipline is **not expanding the product after the MVP is working**.

## Must ship

| Area               | MVP requirement                                                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| Repository support | Local Git repositories                                                          |
| Language focus     | JavaScript and TypeScript projects                                              |
| Branch source      | Active worktrees and explicitly selected local branches                         |
| Branch limit       | Maximum five branches by default                                                |
| Validation         | Base, individual branches, and every branch pair                                |
| Commands           | User-defined setup, test, type-check, lint, and build commands                  |
| Conflict types     | Git conflict, branch failure, behavioral conflict, timeout, environment failure |
| Isolation          | Temporary detached Git worktrees                                                |
| Safety             | Never switch, reset, stash, clean, or modify the user’s current worktree        |
| Output             | Terminal summary, structured JSON, self-contained HTML report                   |
| Codex integration  | Repository-scoped BranchMesh skill                                              |
| Demo               | One command creates and scans a prepared demonstration repository               |
| Runtime network    | None required by BranchMesh itself                                              |
| Judge experience   | Fresh clone to working demo in two or three commands                            |

## Add only after MVP is complete

* cached results;
* testing both branch merge orders;
* GitHub Actions mode;
* SARIF output;
* changed-symbol analysis;
* automatic rerun of failed tests;
* branch selection wizard;
* npm package publishing;
* GitHub Pages-hosted sample report.

## Explicitly out of scope

Do not build these during the hackathon:

* GitHub App;
* GitHub API integration;
* automatic pull-request comments;
* runtime OpenAI API calls;
* automatic AI conflict resolution inside the CLI;
* cloud dashboard;
* authentication;
* user accounts;
* telemetry;
* databases;
* team management;
* support for ten languages;
* snapshotting uncommitted changes;
* three-way or four-way branch combinations;
* Docker or Kubernetes integration;
* IDE extension.

Pairwise branch testing is enough for a strong submission.

---

# 4. Complete user experience

## First-time setup

```bash
git clone <branchmesh-repository>
cd branchmesh
npm ci
npm run build
```

## Run the prepared demo

```bash
npm run demo
```

This should:

1. create a temporary Git repository;
2. create the base branch and three feature branches;
3. show that every feature branch passes individually;
4. run BranchMesh;
5. detect one hidden behavioral conflict;
6. generate and open the HTML matrix.

## Use BranchMesh in a real repository

```bash
branchmesh init
branchmesh doctor
branchmesh scan --base main
```

## Recommended CLI commands

### `branchmesh init`

Creates `branchmesh.config.json`.

It should:

* inspect `package.json`;
* detect available scripts;
* detect npm, pnpm, yarn, or bun lockfiles;
* propose appropriate commands;
* ask nothing when running in noninteractive mode;
* never overwrite an existing config without `--force`.

### `branchmesh doctor`

Checks:

* Git is installed;
* Git version is supported;
* Node version is supported;
* current directory is a repository;
* base reference exists;
* selected branches resolve;
* selected worktrees are clean;
* configured commands exist;
* submodules or Git LFS are present;
* temporary directory is writable.

### `branchmesh scan`

Main command:

```bash
branchmesh scan \
  --base main \
  --branches feature/config,feature/jitter,feature/status \
  --open
```

### `branchmesh demo`

Creates the deterministic demonstration repository and scans it.

### `branchmesh clean`

Removes only BranchMesh-owned orphaned temporary worktrees and run directories.

### `branchmesh version`

Prints:

* BranchMesh version;
* Node version;
* Git version;
* operating system.

---

# 5. CLI exit codes

Exit codes make the product useful in scripts and CI even without a GitHub integration.

| Exit code | Meaning                                     |
| --------: | ------------------------------------------- |
|       `0` | No conflict detected                        |
|       `1` | At least one branch-pair conflict detected  |
|       `2` | Configuration or BranchMesh execution error |
|       `3` | Invalid or failing base branch              |
|       `4` | Dirty or unsupported repository state       |
|     `130` | Interrupted by user                         |

The HTML report should still be generated when exit code `1` is returned.

---

# 6. Recommended technology stack

Use a **single Node package**, not a monorepo.

| Component                | Choice                            |
| ------------------------ | --------------------------------- |
| Runtime                  | Node.js 20+                       |
| Language                 | TypeScript                        |
| CLI parsing              | Commander                         |
| Configuration validation | Zod                               |
| Terminal formatting      | Picocolors                        |
| Build                    | tsup                              |
| Testing                  | Vitest                            |
| Report frontend          | Vanilla HTML, CSS, and JavaScript |
| Process execution        | Node `child_process.spawn`        |
| Temporary files          | Node `os.tmpdir()`                |
| Storage                  | JSON files only                   |
| Package manager          | npm for the BranchMesh repository |

Avoid React for the report. A static report does not need a framework, router, bundler, hydration, or package-heavy UI architecture.

BranchMesh may require packages during installation, but its **runtime behavior should make no HTTP requests**.

---

# 7. System architecture

```text
┌─────────────────────────────────────────────────────────┐
│                     BranchMesh CLI                      │
│  init | doctor | scan | demo | clean | version          │
└──────────────────────────┬──────────────────────────────┘
                           │
                  Configuration Loader
                           │
                    Repository Inspector
                           │
                      Job Planner
          ┌────────────────┼──────────────────┐
          │                │                  │
       Base Job      Individual Jobs      Pair Jobs
          │                │                  │
          └────────────────┼──────────────────┘
                           │
                   Worktree Manager
                           │
                     Command Runner
                           │
                    Result Classifier
                           │
            ┌──────────────┴───────────────┐
            │                              │
        JSON Results                 HTML Report
            │                              │
            └──────────── Codex Skill ─────┘
```

## Main modules

### Repository Inspector

Responsibilities:

* find repository root;
* resolve base SHA;
* enumerate active Git worktrees;
* resolve branch names to immutable SHAs;
* detect dirty worktrees;
* identify changed files;
* identify package manager;
* verify repository prerequisites.

### Job Planner

Creates a deterministic execution graph:

1. base job;
2. one job per branch;
3. one job per branch pair.

For four branches:

```text
Base

A
B
C
D

A+B
A+C
A+D
B+C
B+D
C+D
```

That is:

```text
1 base + n branches + n(n-1)/2 pairs
```

With five branches:

```text
1 + 5 + 10 = 16 jobs
```

That is enough technical depth without becoming unmanageable.

### Worktree Manager

Responsibilities:

* create detached temporary worktrees;
* ensure paths are owned by the current BranchMesh run;
* merge immutable commit SHAs;
* disable commit signing;
* disable repository hooks during synthetic merges;
* abort merges when needed;
* remove temporary worktrees;
* prune BranchMesh-created metadata;
* clean up after errors and cancellation.

### Command Runner

Responsibilities:

* run user-configured commands;
* stream concise progress to the terminal;
* capture stdout and stderr separately;
* enforce command timeouts;
* terminate process trees;
* record exit code, signal, and duration;
* strip ANSI codes for the HTML report;
* limit log size;
* preserve useful raw logs.

### Result Classifier

Turns raw Git and command results into understandable product states.

### Report Generator

Produces:

```text
.branchmesh/runs/<run-id>/report.html
.branchmesh/runs/<run-id>/result.json
.branchmesh/runs/<run-id>/logs/
.branchmesh/latest/report.html
.branchmesh/latest/result.json
```

---

# 8. Git-safety design

This is the most important technical part of the project.

A Git safety bug would damage trust more than a missing feature.

## Non-negotiable safety rules

BranchMesh must never execute any of these in the user’s current worktree:

```bash
git checkout
git switch
git reset
git clean
git stash
git merge
git rebase
```

Every merge and every command must run inside a BranchMesh-owned temporary worktree.

## Preflight sequence

Before any job starts:

1. Locate the repository root.
2. Resolve the base reference to a SHA.
3. Enumerate selected branches.
4. Resolve every branch to a SHA.
5. Save the SHA snapshot in the run manifest.
6. Detect dirty worktrees.
7. Verify no selected branch contains uncommitted changes.
8. Verify maximum branch count.
9. Verify temporary storage.
10. Create a run lock.

Branch refs may move while a scan is running. Therefore, every job must use the captured SHA, not the live branch name.

## Dirty worktree policy

Default behavior:

> Abort or exclude a branch whose checked-out worktree has uncommitted changes.

Do not silently ignore dirty changes. That would produce a misleading report.

Possible message:

```text
feature/payments has uncommitted changes.

BranchMesh scans committed branch tips only.
Commit the changes or rerun with --ignore-dirty to scan the current commit.
```

`--ignore-dirty` should mean “ignore uncommitted changes,” not “include them.”

Supporting uncommitted snapshots is a post-hackathon feature.

---

# 9. Exact scanning algorithm

## Phase 1: Snapshot repository state

Create a run manifest:

```json
{
  "runId": "20260717-branchmesh-a1b2c3",
  "baseRef": "main",
  "baseSha": "abc123",
  "branches": [
    {
      "ref": "feature/config-seconds",
      "sha": "def456"
    },
    {
      "ref": "feature/jitter",
      "sha": "789abc"
    }
  ]
}
```

## Phase 2: Test the base

Create a detached temporary worktree at the base SHA.

Conceptually:

```bash
git worktree add --detach <temporary-path> <base-sha>
```

Run:

1. setup command, when configured;
2. test;
3. type-check;
4. lint;
5. build.

If the base fails, stop normal pair analysis.

Classification:

```text
INVALID_BASELINE
```

Reason:

> You cannot responsibly claim that a branch caused a failure when the base already fails.

Provide an override only for advanced use:

```bash
branchmesh scan --continue-on-base-failure
```

Do not use that override in the demonstration.

## Phase 3: Test every branch independently

For each branch:

1. create a fresh detached worktree at the base SHA;
2. merge the branch SHA into that worktree;
3. run setup and verification commands;
4. store results;
5. remove the temporary worktree.

This tests:

```text
base + branch A
base + branch B
base + branch C
```

Do not simply test the branch’s current tip. Testing the synthetic integration against the selected base gives more meaningful results.

## Phase 4: Test every eligible branch pair

Only create pair jobs when both individual branches passed.

For pair A+B:

1. create a fresh detached worktree at base SHA;
2. merge A;
3. merge B;
4. run verification commands;
5. classify result;
6. remove the worktree.

Use a deterministic canonical order:

```text
lexicographically smaller branch name first
```

Display the merge order in the report.

Example:

```text
Merge order:
1. feature/config-seconds
2. feature/jitter
```

Testing both orders can be a stretch feature.

## Phase 5: Generate results

The engine produces:

* terminal summary;
* structured JSON;
* interactive HTML report.

## Phase 6: Guaranteed cleanup

Cleanup must happen:

* after success;
* after Git conflicts;
* after command failure;
* after timeout;
* after exceptions;
* after `Ctrl+C`;
* after termination signals.

Use:

```typescript
try {
  await runJob();
} finally {
  await cleanupOwnedWorktree();
}
```

Also register process-level signal handling.

Never delete an arbitrary path. Before removal, verify that the target path:

* is beneath the current BranchMesh run directory;
* contains expected BranchMesh ownership metadata;
* corresponds to a worktree listed for the current repository.

---

# 10. Merge implementation details

Synthetic merge commits may require Git identity. Provide temporary environment variables:

```text
GIT_AUTHOR_NAME=BranchMesh
GIT_AUTHOR_EMAIL=branchmesh@local
GIT_COMMITTER_NAME=BranchMesh
GIT_COMMITTER_EMAIL=branchmesh@local
```

Disable signing:

```text
commit.gpgSign=false
```

Disable user Git hooks during BranchMesh synthetic merges by pointing `core.hooksPath` to a BranchMesh-created empty directory.

Use SHA arguments rather than branch names:

```bash
git merge --no-ff --no-edit <captured-sha>
```

When a merge fails, collect:

```bash
git diff --name-only --diff-filter=U
git status --porcelain
```

Then classify the job and clean it up.

---

# 11. Classification model

## Base states

| Classification       | Meaning                      |
| -------------------- | ---------------------------- |
| `BASE_PASS`          | Base verification succeeded  |
| `INVALID_BASELINE`   | Base verification failed     |
| `BASE_SETUP_FAILURE` | Dependencies or setup failed |
| `BASE_TIMEOUT`       | A base command timed out     |

## Individual branch states

| Classification             | Meaning                                         |
| -------------------------- | ----------------------------------------------- |
| `BRANCH_PASS`              | Branch integrates into base and all checks pass |
| `BASE_MERGE_CONFLICT`      | Branch cannot merge cleanly into base           |
| `BRANCH_TEST_FAILURE`      | Tests fail after branch is merged into base     |
| `BRANCH_BUILD_FAILURE`     | Build fails                                     |
| `BRANCH_TYPECHECK_FAILURE` | Type-check fails                                |
| `BRANCH_SETUP_FAILURE`     | Setup command fails                             |
| `BRANCH_TIMEOUT`           | Command times out                               |
| `DIRTY_BRANCH_SKIPPED`     | Branch has uncommitted worktree changes         |

## Pair states

| Classification           | Meaning                                  |
| ------------------------ | ---------------------------------------- |
| `NO_DETECTED_CONFLICT`   | Pair merged and checks passed            |
| `TEXTUAL_CONFLICT`       | Git could not merge the pair             |
| `BEHAVIORAL_CONFLICT`    | A and B pass individually, but A+B fails |
| `PAIR_BUILD_FAILURE`     | Combination fails to build               |
| `PAIR_TYPECHECK_FAILURE` | Combination fails type-checking          |
| `PAIR_TEST_FAILURE`      | Combination fails tests                  |
| `PAIR_SETUP_FAILURE`     | Combination environment setup fails      |
| `PAIR_TIMEOUT`           | Pair command times out                   |
| `PAIR_SKIPPED`           | One individual branch did not pass       |

The report can display the specific technical state while grouping several states under the red **Conflict** status.

---

# 12. Configuration design

Use a checked-in JSON configuration file:

```json
{
  "$schema": "./node_modules/branchmesh/schema.json",
  "base": "main",
  "branches": {
    "source": "worktrees",
    "include": ["feature/*", "codex/*"],
    "exclude": ["main", "develop"]
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
    },
    {
      "id": "typecheck",
      "label": "Type check",
      "kind": "typecheck",
      "command": "npm run typecheck --if-present",
      "timeoutMs": 120000
    },
    {
      "id": "build",
      "label": "Build",
      "kind": "build",
      "command": "npm run build --if-present",
      "timeoutMs": 120000
    }
  ],
  "execution": {
    "maxBranches": 5,
    "concurrency": 2,
    "failFast": false,
    "skipPairsWithFailedBranches": true
  },
  "report": {
    "open": true,
    "outputDirectory": ".branchmesh/runs",
    "maximumEmbeddedLogBytes": 200000
  }
}
```

## Configuration rules

* At least one verification command must exist.
* Every command must have a stable ID.
* Command kinds drive classification.
* Concurrency defaults to two.
* Maximum branches defaults to five.
* Configuration errors must identify the exact field.
* Environment variables may be passed explicitly.
* Never include environment variable values in the HTML report by default.

---

# 13. Command execution model

Use the platform shell for user-defined project commands:

```typescript
spawn(command, {
  cwd: temporaryWorktree,
  shell: true,
  env: sanitizedEnvironment
});
```

Use argument arrays for internal Git commands:

```typescript
spawn("git", ["worktree", "add", "--detach", path, baseSha], {
  shell: false
});
```

This prevents quoting bugs and accidental command injection in internal operations.

## Timeout behavior

When a command exceeds its timeout:

1. send graceful termination;
2. wait briefly;
3. kill the process tree;
4. record timeout;
5. preserve partial logs;
6. classify correctly;
7. continue cleanup.

## Log limits

Suggested defaults:

* terminal: last 20 lines on failure;
* embedded HTML log: first and last relevant sections, maximum 200 KB;
* raw log file: maximum 5 MB per command;
* indicate truncation clearly.

---

# 14. Result data model

A simplified TypeScript model:

```typescript
type CommandKind =
  | "setup"
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "custom";

interface CommandResult {
  id: string;
  label: string;
  kind: CommandKind;
  command: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  status: "passed" | "failed" | "timed_out";
}

interface BranchSnapshot {
  ref: string;
  sha: string;
  worktreePath?: string;
  dirty: boolean;
  changedFiles: string[];
}

interface JobResult {
  id: string;
  kind: "base" | "branch" | "pair";
  baseSha: string;
  branchShas: string[];
  mergeOrder: string[];
  classification: string;
  conflictedFiles: string[];
  commands: CommandResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

interface RunResult {
  schemaVersion: 1;
  runId: string;
  toolVersion: string;
  repositoryRoot: string;
  base: BranchSnapshot;
  branches: BranchSnapshot[];
  jobs: JobResult[];
  summary: {
    branchCount: number;
    pairCount: number;
    passedPairs: number;
    behavioralConflicts: number;
    textualConflicts: number;
    skippedPairs: number;
  };
}
```

Include a schema version immediately. It makes future report and cache migrations easier.

---

# 15. HTML report design

The report is where you score strongly on **Design**.

Do not produce only terminal logs.

## Page structure

### Header

```text
BranchMesh
Compatibility report for sample-repository

Base: main @ abc123
3 branches • 3 pairs • 1 hidden conflict
Completed in 12.4 seconds
```

### Summary cards

* Branches tested
* Pairs tested
* Behavioral conflicts
* Git conflicts
* Passed pairs
* Total duration

### Compatibility matrix

```text
                         config-seconds   jitter     status-ui
config-seconds                  —           ✕            ✓
jitter                          ✕           —            ✓
status-ui                       ✓           ✓            —
```

Each cell needs:

* icon;
* visible text or accessible label;
* hover description;
* keyboard focus;
* clickable details.

Suggested states:

```text
✓ No detected conflict
✕ Behavioral conflict
⚠ Git conflict
! Individual branch failure
○ Skipped
```

Do not rely only on color.

### Conflict detail drawer

When the user clicks the A+B cell, show:

1. branch names and SHAs;
2. merge order;
3. individual branch status;
4. pair status;
5. failed command;
6. duration;
7. relevant failure output;
8. changed files from A;
9. changed files from B;
10. overlapping changed files;
11. conflicted files, where applicable;
12. reproduction command;
13. raw log links.

### Key evidence component

Display this prominently:

```text
feature/config-seconds alone: PASSED
feature/jitter alone:        PASSED
combined:                     FAILED

Failure:
Expected retry delay to be a number.
Received: undefined
```

That is the heart of the product.

### Limitations panel

Include:

> BranchMesh detects incompatibilities observable through the configured commands. Passing combinations may still contain defects not covered by those checks. The current version tests committed branch tips and pairwise combinations only.

This increases credibility.

## Report implementation

Produce a single HTML file with:

* embedded CSS;
* embedded JavaScript;
* embedded sanitized result JSON;
* no CDN;
* no external fonts;
* no analytics;
* no runtime requests.

The report must work after disconnecting the internet.

---

# 16. Repository structure

```text
branchmesh/
├── .agents/
│   └── skills/
│       └── branchmesh/
│           ├── SKILL.md
│           ├── agents/
│           │   └── openai.yaml
│           ├── scripts/
│           │   └── run-branchmesh.mjs
│           ├── references/
│           │   ├── classifications.md
│           │   └── troubleshooting.md
│           └── assets/
│               └── icon.svg
│
├── src/
│   ├── cli.ts
│   ├── commands/
│   │   ├── init.ts
│   │   ├── doctor.ts
│   │   ├── scan.ts
│   │   ├── demo.ts
│   │   └── clean.ts
│   ├── config/
│   │   ├── schema.ts
│   │   ├── loader.ts
│   │   └── defaults.ts
│   ├── git/
│   │   ├── GitClient.ts
│   │   ├── RepositoryInspector.ts
│   │   ├── WorktreeParser.ts
│   │   └── BranchSnapshot.ts
│   ├── engine/
│   │   ├── JobPlanner.ts
│   │   ├── ScanEngine.ts
│   │   ├── WorktreeManager.ts
│   │   ├── MergeRunner.ts
│   │   ├── CommandRunner.ts
│   │   ├── ResultClassifier.ts
│   │   └── CleanupManager.ts
│   ├── report/
│   │   ├── generateReport.ts
│   │   ├── template.ts
│   │   ├── styles.ts
│   │   └── client.ts
│   ├── demo/
│   │   ├── createDemoRepository.ts
│   │   └── demoDefinition.ts
│   ├── model/
│   │   └── results.ts
│   └── utils/
│       ├── paths.ts
│       ├── hashing.ts
│       ├── logging.ts
│       └── signals.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── helpers/
│       └── TemporaryGitRepository.ts
│
├── docs/
│   ├── architecture.md
│   ├── safety-model.md
│   ├── judge-testing.md
│   └── demo-script.md
│
├── scripts/
│   ├── verify-release.mjs
│   └── generate-sample-report.mjs
│
├── AGENTS.md
├── CODEX_BUILD_LOG.md
├── DECISIONS.md
├── CHANGELOG.md
├── README.md
├── LICENSE
├── branchmesh.config.example.json
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

Codex scans `.agents/skills` from the current directory toward the repository root, so the root-level location above is appropriate for a repository-wide BranchMesh skill. ([OpenAI Developers][1])

---

# 17. Demo repository design

The demonstration must be deterministic, fast, and understandable.

Use plain JavaScript and Node’s built-in test runner so the demo needs no dependency installation.

## Base branch

Files:

```text
src/config.js
src/worker.js
test/worker.test.js
```

Base configuration:

```javascript
export const config = {
  retryDelayMs: 1000
};
```

## Branch A: `feature/config-seconds`

Changes:

* replaces `retryDelayMs` with `retryDelaySeconds`;
* updates `worker.js`;
* updates existing tests.

Branch A passes by itself.

## Branch B: `feature/jitter`

Changes:

* adds `src/jitter.js`;
* adds `test/jitter.test.js`;
* reads `config.retryDelayMs`.

It does not edit the same files as Branch A except importing the existing config.

Branch B passes against the base.

## A+B result

Git merges them without a textual conflict.

However, Branch B’s new jitter code receives:

```javascript
undefined
```

because Branch A removed `retryDelayMs`.

The combined test fails.

This is a clean behavioral conflict:

```text
A alone: pass
B alone: pass
A+B: fail
Git conflict: none
```

## Branch C: `feature/status-output`

Adds an independent status display.

It remains compatible with both A and B.

The final matrix has one obvious red pair and two green relationships.

## Second fixture

Create a separate small textual conflict fixture in integration tests. It does not need to appear in the main video unless time allows.

---

# 18. Development schedule

Based on the rules you pasted, the submission deadline is **Wednesday, July 22, 2026 at 5:00 a.m. Pakistan time**. Treat **Tuesday, July 21 at 5:00 p.m. PKT** as code freeze.

## Friday, July 17 — Vertical slice

### Goal

Get the complete technical path working with ugly output.

### Deliverables

* initialize repository;
* add TypeScript build;
* add `AGENTS.md`;
* implement Git command wrapper;
* implement repository root discovery;
* implement branch SHA resolution;
* implement temporary worktree creation/removal;
* implement one base job;
* implement two-branch combination;
* implement command runner;
* produce JSON output;
* create initial demo repository generator.

### End-of-day gate

This must work:

```bash
npm run demo
```

Expected result:

```text
feature/config-seconds: pass
feature/jitter: pass
combined: fail
```

No HTML report is required yet.

Do not finish Friday without an end-to-end vertical slice.

---

## Saturday, July 18 — Safety and correctness

### Goal

Make the engine trustworthy.

### Deliverables

* complete preflight checks;
* dirty worktree detection;
* immutable SHA snapshots;
* base validation;
* individual branch jobs;
* complete pair planner;
* concurrency limit;
* command timeout;
* signal handling;
* cleanup manager;
* Git conflict capture;
* full classification;
* structured logs;
* integration test repository helper.

### Required integration tests

1. Base passes.
2. Base fails.
3. Branch passes.
4. Branch fails independently.
5. Two branches pass independently but fail together.
6. Two branches have a Git conflict.
7. Command times out.
8. Dirty worktree is rejected.
9. Current working tree is unchanged.
10. Temporary worktrees are removed after failure.
11. Paths containing spaces work.
12. Interrupted scan cleans up correctly.

### End-of-day gate

Run:

```bash
npm run test
npm run typecheck
npm run build
npm run demo
```

Everything must pass consistently.

---

## Sunday, July 19 — Product experience

### Goal

Turn the engine into a coherent developer product.

### Deliverables

* compatibility matrix;
* HTML report;
* conflict detail drawer;
* terminal progress output;
* terminal summary;
* `branchmesh init`;
* `branchmesh doctor`;
* `branchmesh clean`;
* meaningful error messages;
* raw log files;
* report accessibility;
* offline report validation;
* polished demo command.

### End-of-day gate

A person unfamiliar with the repository should understand the problem and result without reading raw logs.

Record a rough practice video. Do not wait until the final day to discover that the demo takes too long.

---

## Monday, July 20 — Codex integration and release quality

### Goal

Make Codex central and make installation judge-friendly.

### Deliverables

* `.agents/skills/branchmesh/SKILL.md`;
* optional `agents/openai.yaml`;
* Codex workflow script;
* root `AGENTS.md`;
* README;
* architecture documentation;
* safety model documentation;
* supported-platform statement;
* judge-testing instructions;
* prebuilt `dist/`;
* package tarball using `npm pack`;
* sample report;
* operating-system tests;
* fresh-clone validation.

### End-of-day gate

On a clean machine or clean directory:

```bash
git clone <repo>
cd branchmesh
npm ci
node dist/cli.js demo
```

The report must open and show the hidden conflict.

---

## Tuesday, July 21 — Submission and polish

### Morning

* run complete test suite;
* fix only release-blocking defects;
* improve README screenshots;
* verify repository licensing;
* inspect repository for secrets;
* verify public access;
* create release tag;
* create release archive;
* publish static sample report when practical.

### Code freeze: 5:00 p.m. PKT

After this point:

* no new features;
* no architecture changes;
* no dependency replacements;
* no major refactoring.

### Evening

* record final video;
* upload publicly to YouTube;
* verify audio;
* verify video duration under three minutes;
* complete Devpost description;
* add repository URL;
* add `/feedback` session ID;
* verify project category;
* test every link in an incognito browser;
* submit well before the 5:00 a.m. deadline.

---

# 19. P0 engineering backlog

Create these as GitHub issues or a local checklist.

| ID     | Task                        | Acceptance condition                                       |
| ------ | --------------------------- | ---------------------------------------------------------- |
| BM-001 | Repository scaffold         | Build, type-check, and test scripts pass                   |
| BM-002 | Git process wrapper         | Captures stdout, stderr, code, duration                    |
| BM-003 | Repository inspector        | Correctly resolves root, base, branches, and worktrees     |
| BM-004 | Temporary worktree manager  | Creates and removes detached worktrees safely              |
| BM-005 | Command runner              | Supports streaming, timeout, and cancellation              |
| BM-006 | Base job                    | Stops or classifies invalid baseline                       |
| BM-007 | Individual branch jobs      | Tests base+branch integrations                             |
| BM-008 | Pair planner                | Generates all unique branch pairs                          |
| BM-009 | Pair runner                 | Merges and tests pairs deterministically                   |
| BM-010 | Classifier                  | Distinguishes Git, behavioral, setup, and timeout failures |
| BM-011 | JSON result writer          | Produces schema-versioned result file                      |
| BM-012 | Demo repository generator   | Reproduces hidden conflict every time                      |
| BM-013 | HTML matrix                 | Displays all branch-pair results                           |
| BM-014 | Conflict detail UI          | Shows evidence and reproduction instructions               |
| BM-015 | Init and doctor commands    | Creates valid config and checks environment                |
| BM-016 | Cleanup and signal handling | Leaves no temporary worktrees                              |
| BM-017 | Codex skill                 | Runs scan and explains report                              |
| BM-018 | README and judge guide      | Fresh user can run demo                                    |
| BM-019 | Release verification        | One command validates release state                        |
| BM-020 | Submission assets           | Video, screenshots, description, session ID                |

---

# 20. Testing strategy

## Unit tests

Focus unit tests on deterministic logic:

* parsing `git worktree list --porcelain`;
* branch filtering;
* pair generation;
* canonical merge ordering;
* configuration validation;
* classification;
* matrix construction;
* log sanitization;
* path ownership checks;
* report HTML escaping;
* cache-key generation, when caching is added.

## Integration tests

Use real temporary Git repositories.

Create a reusable helper:

```typescript
const repo = await TemporaryGitRepository.create();

await repo.commit("base", baseFiles);
await repo.createBranch("feature/a");
await repo.writeFiles(branchAFiles);
await repo.commitCurrent("branch A");
```

Avoid mocking Git for integration-critical behavior.

## End-to-end tests

### Hidden conflict

```text
base passes
A passes
B passes
A+B fails
classification = BEHAVIORAL_CONFLICT
exit code = 1
```

### Text conflict

```text
A and B edit the same line
pair merge fails
classification = TEXTUAL_CONFLICT
```

### Invalid baseline

```text
base test fails
pair jobs are not executed
classification = INVALID_BASELINE
exit code = 3
```

### Safety

Record before scan:

```bash
git status --porcelain
git rev-parse HEAD
```

Run BranchMesh.

Record after scan and assert both values are unchanged.

Also assert:

```bash
git worktree list
```

contains no BranchMesh temporary worktrees.

## Release verification command

Create:

```bash
npm run verify
```

It should run:

```text
format check
lint
type-check
unit tests
integration tests
build
demo smoke test
offline report check
package verification
```

---

# 21. Codex development workflow

Use **one primary Codex session** for the majority of the core functionality. That should be the session submitted through `/feedback`.

Keep the main session responsible for:

* product requirements;
* architecture decisions;
* milestone planning;
* integration;
* final reviews;
* release verification.

Use subagents for bounded work:

* Git safety review;
* test-case design;
* report interface critique;
* cross-platform audit;
* README review.

Codex supports specialized subagents running in parallel, but OpenAI’s guidance warns that parallel write-heavy work can create coordination overhead. Use subagents primarily for analysis, testing, review, and isolated modules rather than letting several agents modify the same files. Ultra can proactively delegate when parallel work materially improves the result. ([OpenAI Developers][2])

GPT-5.6 Sol and Ultra are currently available in Codex for eligible plans, so your chosen development setup is aligned with the event’s tooling. ([OpenAI][3])

## Root `AGENTS.md`

Codex reads repository `AGENTS.md` guidance before beginning work, so place your engineering constraints there rather than repeating them in every prompt. ([OpenAI Developers][4])

Use this initial content:

```markdown
# BranchMesh Engineering Rules

## Product contract

BranchMesh is a deterministic local developer tool that detects branch
combinations which pass individually but fail when integrated.

## Non-negotiable constraints

- Make no OpenAI API or external API calls.
- Make no runtime HTTP requests.
- Never modify the user's current working tree.
- Never run checkout, reset, clean, stash, merge, or rebase in the user's
  current working tree.
- Run all synthetic merges and project commands in BranchMesh-owned temporary
  worktrees.
- Snapshot branch SHAs before execution.
- Reject dirty selected worktrees by default.
- Every cleanup path must be tested.
- Every bug fix requires a regression test.
- Use argument arrays for internal Git commands.
- Escape all untrusted content inserted into HTML.
- Keep the report completely offline.
- Prefer a narrow reliable implementation over additional features.

## Required verification

Before declaring a task complete, run:

- npm run typecheck
- npm test
- npm run build

For Git-engine changes, also run the relevant integration and safety tests.

## Architecture boundaries

- src/git contains Git inspection and command wrappers.
- src/engine contains job planning and execution.
- src/report contains report generation only.
- CLI commands should orchestrate modules and contain minimal business logic.
- Do not add production dependencies without documenting the reason.

## Development conduct

- Keep commits small and intentional.
- Record major human product decisions in DECISIONS.md.
- Record material Codex contributions in CODEX_BUILD_LOG.md.
- Do not claim compatibility beyond what configured checks demonstrate.
```

## Primary Codex prompt

```text
We are building BranchMesh for OpenAI Build Week.

BranchMesh is a deterministic local CLI and Codex skill that identifies Git
branches which pass independently but fail when combined.

The product must make no OpenAI API calls, no external API calls, no telemetry,
and no runtime network requests. It must never modify the user's current
working tree.

Read AGENTS.md first.

For this milestone:

1. Inspect the repository and current implementation.
2. Restate the product contract and safety invariants.
3. Produce a concrete implementation plan for the smallest end-to-end vertical
   slice.
4. Delegate read-only Git-safety analysis and test-case design to separate
   subagents.
5. Implement the vertical slice:
   - resolve a base and two branch SHAs;
   - create an isolated temporary worktree;
   - merge the branches;
   - run a configured command;
   - classify the result;
   - write structured JSON;
   - clean up in all cases.
6. Add automated tests.
7. Run type-check, tests, and build.
8. Review the final diff against the safety invariants.
9. Update CODEX_BUILD_LOG.md and DECISIONS.md.

Do not implement the HTML report, caching, GitHub integration, automatic fixes,
or additional language support in this milestone.
```

## Recommended subagent ownership

| Subagent                | Responsibility                          | Write permission   |
| ----------------------- | --------------------------------------- | ------------------ |
| Safety reviewer         | Audit worktree and cleanup design       | No                 |
| Test designer           | Propose adversarial Git fixtures        | Tests only         |
| Report designer         | Review HTML hierarchy and accessibility | Report folder only |
| Cross-platform reviewer | Identify Windows/macOS/Linux risks      | No                 |
| Documentation reviewer  | Verify judge instructions               | Docs only          |

Never give two agents simultaneous ownership of `WorktreeManager.ts`.

---

# 22. Codex skill design

Path:

```text
.agents/skills/branchmesh/SKILL.md
```

## Suggested front matter

```markdown
---
name: branchmesh
description: Check active Git branches or Codex worktrees for hidden integration conflicts by running the local BranchMesh compatibility scanner. Use when the user asks whether parallel branches, agent worktrees, or feature branches can be merged safely. Do not use for ordinary single-branch test execution.
---
```

## Skill workflow

The instructions should tell Codex to:

1. confirm the directory is a Git repository;
2. read `branchmesh.config.json`;
3. run `branchmesh doctor`;
4. stop when selected worktrees are dirty;
5. run `branchmesh scan`;
6. read `.branchmesh/latest/result.json`;
7. summarize:

   * base status;
   * individual branch status;
   * problematic pairs;
   * exact failed commands;
   * relevant evidence;
8. avoid claiming absolute safety;
9. avoid modifying code unless the user requests a fix;
10. when fixing, work on a new branch or worktree;
11. rerun BranchMesh after the fix.

Codex can activate a skill through explicit selection or when the task matches the skill description, so make the description specific and use terms such as “branches,” “worktrees,” “integration conflict,” and “parallel agents.” ([OpenAI Developers][1])

---

# 23. Evidence of Codex and GPT-5.6 collaboration

Create `CODEX_BUILD_LOG.md`.

Example:

```markdown
# Codex Build Log

## July 17 — Architecture and vertical slice

Codex contributions:
- Proposed the initial job graph.
- Implemented the first Git process wrapper.
- Generated temporary repository test helpers.
- Identified cleanup failure paths.

Human decisions:
- Limited the MVP to committed branch tips.
- Chose pairwise analysis rather than three-way combinations.
- Rejected automatic conflict fixing.
- Chose a static HTML report instead of React.

Verification:
- npm run typecheck
- npm test
- npm run build

Relevant commits:
- abc123 feat: add temporary worktree runner
- def456 test: add hidden integration conflict fixture
```

Create `DECISIONS.md`.

Important decisions to record:

* why there are no runtime API calls;
* why pairwise analysis is used;
* why dirty branches are rejected;
* why tests are evidence rather than AI judgment;
* why automatic fixes are not part of MVP;
* why the report says “no detected conflict”;
* why JavaScript/TypeScript is the first supported ecosystem.

At the end of the primary project session, submit `/feedback` and save the returned session ID. OpenAI’s current Codex documentation confirms that feedback submission returns a shareable session ID. ([OpenAI Developers][5])

---

# 24. Risk register

| Risk                                           | Impact   | Mitigation                                                                                |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Accidental modification of user repository     | Critical | Detached temporary worktrees; no mutation commands in current worktree; integration tests |
| Cleanup failure                                | High     | `finally` cleanup, signal handlers, ownership metadata, `branchmesh clean`                |
| Base branch already fails                      | High     | Mandatory baseline job                                                                    |
| Dirty worktrees create false confidence        | High     | Reject by default                                                                         |
| Dependency setup is slow                       | Medium   | Configurable setup; concurrency two; dependency-free demo                                 |
| Pair scans take too long                       | Medium   | Maximum five branches; skip pairs involving failed branches                               |
| Flaky tests create false conflicts             | Medium   | Display exact evidence; optional failure rerun as stretch                                 |
| Sequential merge order affects result          | Medium   | Deterministic order shown in report; both-orders mode later                               |
| No runtime AI weakens hackathon story          | High     | Codex skill is the primary interface; strong build log and session evidence               |
| Report looks like a prototype                  | High     | Dedicated report day; matrix-first UX; static sample report                               |
| Cross-platform bugs                            | Medium   | Use Node APIs; avoid shell scripts; test paths with spaces                                |
| User expects uncommitted changes to be scanned | Medium   | Clear preflight warning and documented limitation                                         |
| Tests do not cover real incompatibility        | Medium   | Explain evidence boundary honestly                                                        |
| Too many features delay submission             | Critical | Locked P0/P1 scope and Tuesday code freeze                                                |

---

# 25. Feature-cut order

When behind schedule, remove features in this exact order:

1. caching;
2. `branchmesh init` wizard;
3. reverse merge-order testing;
4. changed-file intersections;
5. hosted sample report;
6. Windows native support beyond WSL;
7. terminal animations;
8. custom report filters.

Never cut:

* worktree isolation;
* cleanup;
* base validation;
* individual testing;
* pair testing;
* behavioral conflict classification;
* deterministic demo;
* HTML matrix;
* Codex skill;
* README;
* `/feedback` session evidence.

---

# 26. Three-minute demo script

## 0:00–0:18 — Problem

> “Parallel coding agents can each create a branch that passes its own tests. Git may merge those branches without a line conflict, but the combined product can still break.”

Show three branches.

## 0:18–0:38 — Individual success

Show:

```text
config-seconds: passed
jitter: passed
status-output: passed
```

Say:

> “Every branch succeeds independently.”

## 0:38–0:58 — Run BranchMesh

```bash
branchmesh scan --base main
```

Show concise progress.

## 0:58–1:25 — Matrix reveal

Open the matrix.

Show one red cell:

```text
config-seconds + jitter
Behavioral conflict
```

## 1:25–1:52 — Evidence

Open details.

Show:

```text
A alone: passed
B alone: passed
A+B: failed
Git merge conflict: none
Failed command: npm test
```

Show the relevant test output.

## 1:52–2:13 — Codex skill

In Codex:

> “Use BranchMesh to explain the conflict between my active worktrees.”

Show Codex reading the structured result and explaining the property mismatch.

## 2:13–2:35 — Fix and verify

Apply the prepared fix.

Run BranchMesh again.

Show the matrix turning green.

## 2:35–2:52 — How it was built

Briefly show:

* primary Codex session;
* subagent safety review;
* integration tests;
* decision log;
* dated commits.

Say explicitly:

> “GPT-5.6 and Codex were used for architecture, implementation, test generation, Git-safety review, report design, and release verification.”

## 2:52–3:00 — Closing

> “BranchMesh lets developers move at agent speed without blindly merging agent work.”

Do not include an intro animation longer than two seconds.

---

# 27. README structure

Your README should contain these sections in this order:

1. Logo, title, and tagline
2. One-paragraph explanation
3. Animated GIF or screenshot of the matrix
4. The hidden-conflict example
5. Quick demo
6. Installation
7. Real-repository usage
8. Configuration
9. How BranchMesh works
10. Classification meanings
11. Safety guarantees
12. Codex skill usage
13. How GPT-5.6 and Codex were used
14. Supported platforms
15. Current limitations
16. Judge testing instructions
17. Architecture
18. Development-period documentation
19. License

## Top README commands

```bash
git clone <repository>
cd branchmesh
npm ci
npm run demo
```

No judge should need to read twenty paragraphs before finding the demo command.

---

# 28. Judge testing instructions

Create `docs/judge-testing.md`.

It should offer two paths.

## Fastest demonstration

```bash
git clone <repository>
cd branchmesh
npm ci
npm run demo
```

Expected outcome:

```text
One behavioral conflict is detected between:
feature/config-seconds
feature/jitter
```

## Test on another repository

```bash
npm run build
npm link

cd /path/to/javascript-project
branchmesh init
branchmesh doctor
branchmesh scan --base main
```

State exactly which platforms you actually tested. Do not claim native Windows support unless you ran it successfully.

Provide:

* prebuilt `dist/`;
* a release `.tgz`;
* a pre-generated sample report;
* the demo repository generator.

---

# 29. Submission checklist

## Product

* [ ] `npm run verify` passes
* [ ] `npm run demo` works from a clean clone
* [ ] Current worktree remains unchanged
* [ ] No orphan worktrees remain
* [ ] HTML report works offline
* [ ] No runtime API calls
* [ ] No telemetry
* [ ] No secrets
* [ ] No copied copyrighted assets
* [ ] Error states are understandable

## Repository

* [ ] Public repository, or correctly shared private repository
* [ ] Relevant open-source license
* [ ] Complete README
* [ ] Setup instructions
* [ ] Sample data or deterministic fixture
* [ ] Supported platforms
* [ ] Limitations
* [ ] Judge-testing instructions
* [ ] Prebuilt release
* [ ] Dated commit history
* [ ] `CODEX_BUILD_LOG.md`
* [ ] `DECISIONS.md`
* [ ] Codex skill included

## Video

* [ ] Public YouTube video
* [ ] Less than three minutes
* [ ] Clear audio
* [ ] Working product shown
* [ ] Hidden conflict demonstrated
* [ ] Codex and GPT-5.6 use explained
* [ ] No copyrighted music
* [ ] No unnecessary third-party trademarks

## Devpost

* [ ] Developer Tools category
* [ ] Project description
* [ ] Repository URL
* [ ] Video URL
* [ ] Installation instructions
* [ ] Testing instructions
* [ ] `/feedback` Codex session ID
* [ ] Screenshots
* [ ] Submission completed before deadline
* [ ] Links tested while logged out

---

# 30. Final definition of done

BranchMesh is submission-ready only when all of the following are true:

```text
1. The base branch passes.
2. Branch A passes individually.
3. Branch B passes individually.
4. A+B merges without a Git conflict.
5. A+B fails a configured test.
6. BranchMesh classifies it as a behavioral conflict.
7. The matrix displays the correct red pair.
8. Clicking the pair shows useful evidence.
9. The current repository remains unchanged.
10. All temporary worktrees are removed.
11. The report works offline.
12. The Codex skill can run the scan and explain the result.
13. A new user can reproduce the demonstration from the README.
14. The video demonstrates the complete story in under three minutes.
15. The submission contains the primary /feedback session ID.
```

The first target is not the polished matrix. It is this vertical slice:

```text
create temporary worktree
→ combine two branch SHAs
→ run one test command
→ detect failure
→ write JSON
→ clean up safely
```

Once that works reliably, build the product experience around it.

[1]: https://developers.openai.com/codex/build-skills "
  Build skills | ChatGPT Learn
"
[2]: https://developers.openai.com/codex/subagents "
  Subagents | ChatGPT Learn
"
[3]: https://openai.com/index/gpt-5-6/ "GPT-5.6: Frontier intelligence that scales with your ambition | OpenAI"
[4]: https://developers.openai.com/codex/agent-configuration/agents-md "
  Custom instructions with AGENTS.md | ChatGPT Learn
"
[5]: https://developers.openai.com/codex/reference/troubleshooting "
  Troubleshooting | ChatGPT Learn
"
