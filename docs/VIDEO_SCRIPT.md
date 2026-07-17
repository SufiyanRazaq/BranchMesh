# Three-minute English video script

Target duration: 2:50–2:58. Use only the real deterministic demo and its generated report. The
spoken script below uses the evidence-safe Codex wording; replace the marked sentence with the
GPT-5.6 version only after checking primary-session metadata.

## 0:00–0:18 — The problem

Visual: show the three demo branch names.

> Parallel coding agents can each return a branch whose tests pass. Git can merge those branches
> without a line conflict while their combined behavior still breaks. That hidden integration
> failure is what BranchMesh detects.

## 0:18–0:36 — Independently passing branches

Visual: show the base and branch status lines.

> This deterministic fixture has three feature branches. Config-seconds, jitter, and status-output
> all pass independently against one captured base.

## 0:36–0:58 — Run the real product

Visual: run a prebuilt local CLI with a fresh external output directory.

> BranchMesh snapshots the base and full branch SHAs, then evaluates them in fresh detached
> worktrees. This direct demo returns exit code one deliberately: finding an incompatibility is a
> completed scan result, not a crash.

## 0:58–1:24 — Matrix reveal

Visual: open the newly generated local `report.html` and focus the compatibility matrix.

> The matrix shows two relationships with no detected conflict and one behavioral conflict:
> config-seconds plus jitter. Git combined that pair cleanly, so this is not a textual conflict.

## 1:24–1:53 — Evidence

Visual: activate the failing matrix cell and show the evidence drawer.

> Both individual jobs passed. The pair failed the configured node test command, producing
> BEHAVIORAL_CONFLICT with technical classification PAIR_TEST_FAILURE. The report includes the full
> captured SHAs, merge order, failed command, exit status, duration, and bounded standard output and
> error.

## 1:53–2:15 — Safety and output

Visual: show the safety model and report files.

> Every synthetic merge runs under an ownership-marked temporary root. BranchMesh never checks
> out, resets, stashes, cleans, or merges in the user's worktree. Results are Zod-validated and
> published outside the repository as JSON, separate logs, and one self-contained offline HTML
> file.

## 2:15–2:35 — Codex skill

Visual: show the real Codex explanation only after actual host discovery has succeeded.

> The repository-scoped Codex skill runs doctor first, invokes the same deterministic CLI,
> validates the exact result, and explains the branch names, captured SHAs, classifications, failed
> command, evidence, and report location. It does not bypass safety checks or apply a fix unless I
> separately request one.

## 2:35–2:51 — How it was built

Visual: show `CODEX_BUILD_LOG.md`, `DECISIONS.md`, tests, and dated commits.

Default evidence-safe narration:

> Codex supported architecture, implementation, adversarial testing, report and skill design, and
> release review. Humans set the safety boundaries, approved each milestone, reviewed defects, and
> controlled commits. BranchMesh makes no runtime model call.

After verified GPT-5.6 session evidence, replace the first sentence with:

> GPT-5.6 through Codex supported architecture, implementation, adversarial testing, report and
> skill design, and release review.

## 2:51–3:00 — Close

Visual: return to the matrix and BranchMesh title.

> BranchMesh helps teams move at agent speed without blindly combining independently passing
> branches.
