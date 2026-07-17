# OpenAI Build Week submission draft

This document is copy-ready except for the explicitly marked human-only facts and links. It makes
no performance, cross-platform execution, screenshot, publication, or model-version claim that is
not backed by repository evidence.

## Devpost title

**BranchMesh**

## Tagline

**Git catches line conflicts. BranchMesh catches branches that merge cleanly but break each
other.**

## Project description

BranchMesh is a local-first TypeScript CLI and repository-scoped Codex skill that detects hidden
integration failures between committed Git branches. It snapshots immutable commit IDs, evaluates
branches independently and in pairs inside isolated detached worktrees, runs repository-defined
checks, and produces terminal, validated JSON, separate-log, and self-contained offline HTML
evidence. A passing pair means only **No detected conflict under the configured commands**.

## Problem

Parallel developers and coding agents can each produce a branch whose tests pass independently.
Git may combine those branches without a textual conflict even when one branch silently invalidates
another branch's assumptions. The failure then appears late, after integration, when it is harder
to identify which combination caused it.

## Solution

BranchMesh evaluates the captured base, each selected branch, and every canonical branch pair
before integration. It never performs synthetic merges in the user's worktree. Instead it creates
fresh ownership-marked temporary worktrees, runs the configured setup and validation pipeline,
classifies textual versus behavioral failures, and preserves the exact command evidence behind
each result.

## Feature summary

- Select two to five explicit local branches or discover branches in active worktrees.
- Snapshot the base and every branch to a full immutable commit ID before scheduling work.
- Gate on a valid base, run every individual branch, and represent every planned canonical pair.
- Record `PAIR_SKIPPED` when an individual branch failure makes a pair ineligible.
- Distinguish textual Git conflicts, behavioral conflicts, setup failures, timeouts, and command
  kinds.
- Preserve deterministic result order with bounded concurrency.
- Bound stdout/stderr, enforce timeouts, terminate process trees, and handle interruption.
- Use ownership-marked temporary roots and conservative, verified, idempotent cleanup.
- Publish a terminal matrix, strict JSON, separate raw logs, and one self-contained offline HTML
  report.
- Provide `init`, `doctor`, `scan`, `demo`, `clean`, and `version` commands.
- Provide a repository-scoped Codex skill that runs doctor first, invokes the deterministic CLI,
  validates the exact result, and explains the evidence.
- Include a deterministic dependency-free demo with three passing branches and one clean-merge
  behavioral conflict.

## Technical implementation

BranchMesh is one Node.js 20+ TypeScript package using Commander, Zod, Picocolors, tsup, and Vitest.
Internal Git and operating-system processes use executable-plus-argv calls with `shell: false`
and explicit working directories. Unchanged user-configured setup and validation strings are the
only shell boundary.

Preflight resolves the canonical repository root and common Git directory, discovers worktrees
through porcelain-`-z`, rejects unsupported state, checks selected worktree dirt, and snapshots
every selected ref to a full commit ID. Each base, individual, or pair job receives a fresh
detached worktree beneath a private BranchMesh-owned temporary root. Synthetic merges use captured
SHAs, an empty hooks directory, fixed local identity, and disabled signing, rerere, maintenance,
and automatic garbage collection.

Zod schemas enforce configuration, job/result invariants, classification rules, report
projections, and exit precedence. Persistent evidence is redacted, revalidated, and atomically
published outside the scanned repository. The HTML renderer embeds only a validated report
projection, CSS, and JavaScript; it uses no CDN, external font/image, analytics, fetch call, or
runtime request. The Codex skill remains a thin workflow around the compiled deterministic engine
instead of duplicating scanning logic.

## How Codex was used

Codex was the primary engineering collaborator for architecture, implementation, temporary Git
fixtures, adversarial Git/process/ownership testing, report and CLI design, skill construction,
documentation, and repeated safety and release review. The dated activity is recorded in
`CODEX_BUILD_LOG.md`, accepted product decisions in `DECISIONS.md`, and implementation
progression in Git history. BranchMesh itself makes no runtime model call.

## GPT-5.6 attribution

The approved development workflow selected GPT-5.6 Sol Ultra, but repository files cannot
independently establish the primary Codex session's backing model. Verify the session metadata
before submission.

If the metadata confirms GPT-5.6, use:

> GPT-5.6 through Codex was the primary engineering collaborator for architecture,
> implementation, test generation, Git-safety review, report design, documentation, and release
> verification. This was a development-time collaboration; BranchMesh makes no runtime model or
> API calls.

If the metadata does not confirm it, use:

> Codex was the primary engineering collaborator. The available project evidence does not verify
> the backing model version, so we do not make a GPT-5.6-specific claim. BranchMesh makes no
> runtime model or API calls.

## Important human decisions and manual supervision

Humans locked and approved:

- pairwise committed-tip analysis instead of uncommitted snapshots or higher-order combinations;
- private owned temporary worktrees and persistent report storage outside the scanned repository;
- one primary causal classification plus an optional pair technical classification;
- exit-code precedence, mandatory base gating, and explicit `PAIR_SKIPPED` results;
- macOS/Linux/WSL scope and rejection of native Windows, submodules, and Git LFS;
- the configured-command shell boundary and argv-only internal process boundary;
- no backend, cloud service, telemetry, GitHub integration, runtime AI, or automatic fixes;
- evidence wording that reports “No detected conflict” rather than absolute safety.

Manual supervision included milestone-by-milestone scope approval, regression-first defect
correction, full-suite verification, dedicated Git-safety and product audits, explicit commit
authorization, and control over any push, tag, publication, or submission.

## Evidence available to judges

- deterministic real demo and acceptance harness;
- strict result JSON and one real generated offline HTML report under `docs/samples`;
- unit, integration, adversarial Git, process-tree, interruption, cleanup, report, CLI, package,
  skill, and documentation tests;
- architecture, safety, configuration, classification, platform, limitation, troubleshooting, and
  judge guides;
- build log, decision log, and dated commit history.

## Claims that require manual confirmation

- public/logged-out repository access;
- primary-session GPT-5.6 model metadata;
- actual Codex host discovery of the repository skill;
- manual browser, keyboard, screen-reader, and print review;
- Linux and WSL release-matrix execution;
- selected license;
- captured screenshots and uploaded video;
- public video URL, repository URL, and primary `/feedback` session ID;
- all Devpost links working while logged out.
