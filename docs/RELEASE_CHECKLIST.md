# BranchMesh release and submission checklist

This checklist separates machine-verifiable evidence from actions that require the repository
owner or a submission UI. No push, tag, publication, upload, or submission is performed by the
release verification.

## Automated source gates

- [x] The prior clean candidate clone installed with `npm ci`; the current uncommitted delta passes
      in the primary checkout and as a fresh packed-prefix install.
- [x] Formatting check passes.
- [x] Lint passes with zero warnings.
- [x] Strict TypeScript check passes.
- [x] Unit tests pass.
- [x] Integration tests pass.
- [x] Build passes.
- [x] Real demo verification passes while observing the expected scan exit `1`.
- [x] Checked-in result and offline HTML samples pass contract/offline validation.
- [x] Repository-scoped skill wrapper verification passes.
- [x] `npm pack` succeeds outside the repository.
- [x] The archive contains exactly the intended nine files, including `LICENSE`.
- [x] Packed CLI installs into an empty temporary prefix.
- [x] Packed CLI help, version, invalid-input, and real-demo behavior match the contract.

## Safety and artifact gates

- [x] Original HEAD, branch, index, refs, status, tracked/untracked files, and worktree list remain
      unchanged through demo verification.
- [x] No BranchMesh execution worktrees or report stages remain.
- [x] No runtime HTTP/model client or telemetry exists in BranchMesh code.
- [x] Documentation distinguishes BranchMesh runtime from user-configured commands that may use
      the network.
- [x] No candidate secret, personal path, token, temporary fixture, generated raw log, package
      archive, `node_modules`, `dist`, or coverage output is tracked or included in a proposed
      commit.
- [x] Sample JSON validates through `RunResultSchema`.
- [x] Sample HTML's embedded projection validates through `ReportProjectionSchema`.
- [x] Sample HTML has no external assets, fetch call, analytics, or runtime request.
- [x] Claims match observed macOS/demo/package behavior and qualify pending Linux/WSL evidence.

## Human release gates

- [x] Add the MIT License with the approved copyright notice.
- [x] Confirm `0.1.0` as the release-candidate version.
- [ ] Make the repository public or share it with judges as required.
- [ ] Test the repository URL while logged out.
- [ ] Confirm primary Codex session metadata before naming GPT-5.6.
- [ ] Confirm actual Codex host discovery and execute the skill against the deterministic demo.
- [ ] Perform manual browser, keyboard, screen-reader, responsive, and print review.
- [ ] Run Linux and WSL verification if claiming executed support rather than implementation
      support.
- [ ] Capture real screenshots using `docs/SCREENSHOT_CHECKLIST.md`.
- [ ] Record and upload the under-three-minute video using `docs/VIDEO_SCRIPT.md`.
- [ ] Submit `/feedback` from the primary Codex development session and save its session ID.
- [ ] Fill Devpost repository, video, installation, testing, and session-ID fields.
- [ ] Test every submission link while logged out.
- [ ] Submit before the event deadline.

## Known release risk

- An earlier macOS interruption repetition intermittently returned a process-group `EPERM`
  instead of the expected interruption. Release-candidate stress testing reproduced the race in
  configured-command termination, internal Git cancellation, and interrupted `git worktree add`.
  Regression-first corrections now avoid stale process-group signals, fail closed when termination
  cannot be proven, preserve non-idle owned roots, and allow ownership-critical worktree
  registration to finish before exact cleanup. The final focused gate passed 20 consecutive fresh
  Vitest processes (60/60 cases) on macOS. This remains a portability risk until the same stress
  gate is executed on Linux and WSL; those environments were not executed in this release session.
