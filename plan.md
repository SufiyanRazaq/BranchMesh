## Yes—develop BranchMesh completely with Codex

That is actually the correct strategy for this hackathon. **Codex should write most of the implementation**, while you remain responsible for product decisions, testing, safety review, and final approval.

BranchMesh itself will still make **no ChatGPT API or external API calls**. Codex is only the development environment used to build it.

Codex supports repository instructions through `AGENTS.md`, reusable workflows through skills, and bounded delegation through subagents—all useful for BranchMesh. ([OpenAI Developers][1]) GPT-5.6 Sol is positioned for complex coding and long-horizon work, so using Sol Ultra as your primary development model is appropriate. ([OpenAI][2])

# Correct development arrangement

## Your responsibilities

You should control:

* the final product scope;
* architecture approval;
* Git-safety requirements;
* feature prioritization;
* acceptance testing;
* manual demo verification;
* UI and product-quality decisions;
* final submission.

## Codex responsibilities

Codex should handle:

* repository scaffolding;
* TypeScript implementation;
* Git command wrapper;
* worktree management;
* command execution and timeouts;
* classification logic;
* demo repository generator;
* unit and integration tests;
* HTML report;
* CLI commands;
* Codex skill;
* documentation;
* bug fixing;
* release verification.

Do not manually write most of the code unless Codex becomes stuck. Your role is to guide, inspect, test, and correct it.

# Use one primary Codex session

This is especially important because the submission requires the `/feedback` session ID where most core functionality was developed.

Use one primary thread for:

* architecture;
* implementation;
* milestone progression;
* integration;
* debugging;
* final review.

Do not create a new main session every day. Long conversations may become large, but retaining one principal project session gives you stronger evidence that BranchMesh was genuinely developed through Codex.

You can use subagents inside that session for:

* reviewing Git safety;
* designing integration tests;
* reviewing the HTML report;
* checking Windows/macOS/Linux compatibility;
* auditing documentation.

OpenAI recommends bounded subagent tasks while keeping the primary agent focused on the central problem. ([OpenAI Developers][3])

# Do not give Codex one enormous request

Do **not** say:

> “Build the complete BranchMesh project.”

That often produces a large, inconsistent implementation with hidden problems.

Develop it milestone by milestone.

## Milestone 1 — End-to-end vertical slice

Ask Codex to build only:

```text
Resolve base and two branch SHAs
→ create isolated worktree
→ merge both branches
→ run one configured command
→ classify pass/failure
→ write result.json
→ clean up the worktree
```

Acceptance:

```bash
npm run typecheck
npm test
npm run build
npm run demo
```

The demo must show:

```text
Branch A alone: passed
Branch B alone: passed
A+B combined: failed
```

Do not continue until this works reliably.

## Milestone 2 — Complete scanning engine

Add:

* repository inspector;
* base validation;
* individual branch jobs;
* all unique branch pairs;
* branch snapshot SHAs;
* dirty-worktree detection;
* timeouts;
* cancellation;
* cleanup after failures;
* Git-conflict detection;
* structured classifications.

## Milestone 3 — Automated safety testing

Tell Codex to create real temporary Git repositories for tests covering:

* behavioral conflicts;
* normal Git conflicts;
* invalid baseline;
* branch failure;
* timeout;
* dirty worktrees;
* paths containing spaces;
* interruption cleanup;
* unchanged original worktree;
* no orphaned temporary worktrees.

This milestone is more important than the interface.

## Milestone 4 — Product experience

Build:

* terminal progress;
* compatibility matrix;
* summary cards;
* pair-detail drawer;
* logs;
* reproduction command;
* offline HTML report;
* accessible status indicators.

## Milestone 5 — CLI completeness

Implement:

```bash
branchmesh init
branchmesh doctor
branchmesh scan
branchmesh demo
branchmesh clean
branchmesh version
```

## Milestone 6 — Codex skill

Create:

```text
.agents/skills/branchmesh/
├── SKILL.md
├── scripts/
├── references/
└── agents/openai.yaml
```

The skill should let the user say:

> “Use BranchMesh to check my active worktrees.”

Codex should run the deterministic scanner and interpret its JSON evidence. Skills are the official mechanism for packaging reusable Codex instructions, supporting resources, and scripts. ([OpenAI Developers][1])

## Milestone 7 — Submission preparation

Use Codex to produce:

* polished README;
* architecture documentation;
* judge-testing guide;
* safety model;
* release package;
* screenshots;
* sample report;
* Devpost description draft;
* video narration draft;
* complete release audit.

# Recommended Codex usage

## Primary model

Use **GPT-5.6 Sol Ultra** for:

* architecture;
* primary implementation;
* complicated debugging;
* Git-safety reasoning;
* cross-module integration;
* final code review.

Do not switch models repeatedly during core development.

## Subagents

Use no more than three or four bounded subagents at once.

Good delegation:

```text
Subagent 1: Review WorktreeManager for repository safety.
Subagent 2: Create adversarial Git integration-test scenarios.
Subagent 3: Review the HTML report for clarity and accessibility.
```

Bad delegation:

```text
Agent 1 builds the Git engine.
Agent 2 also changes the Git engine.
Agent 3 refactors the architecture.
Agent 4 rewrites everything.
```

Multiple agents editing the same critical module will waste time and introduce conflicts.

# Required repository controls

Before starting implementation, place an `AGENTS.md` file in the repository root. Codex automatically uses repository-level instructions from `AGENTS.md`. ([OpenAI Developers][4])

It should enforce:

```markdown
- Never modify the user's current worktree.
- Never run checkout, reset, clean, stash, merge, or rebase there.
- Use only BranchMesh-owned temporary worktrees.
- Snapshot branch SHAs before execution.
- Reject dirty selected worktrees by default.
- Test every cleanup path.
- Add a regression test for every bug.
- Make no runtime HTTP or model calls.
- Keep the HTML report fully offline.
- Do not add features outside the approved milestone.
```

# Your review cycle after every milestone

After Codex finishes a milestone, make it perform this sequence:

```text
1. Show the files changed.
2. Explain the implementation.
3. Identify remaining risks.
4. Run type-checking.
5. Run unit tests.
6. Run integration tests.
7. Run the build.
8. Run the real demo.
9. Review its own diff.
10. Commit the milestone.
```

Use small commits:

```text
feat: add isolated worktree execution
test: add behavioral conflict fixture
feat: add branch pair planner
feat: generate offline compatibility report
docs: add judge testing instructions
```

This commit history will also help demonstrate that the project was created during the hackathon.

# What not to allow Codex to do

Stop Codex when it tries to:

* build GitHub integration;
* add a backend;
* call an AI API;
* support many languages;
* add automatic conflict fixing;
* create cloud accounts;
* implement three-way branch combinations;
* introduce React for a simple static report;
* rewrite stable modules unnecessarily;
* skip tests because “the implementation looks correct”;
* claim that passing means branches are guaranteed safe.

# How much supervision is required?

You should not blindly accept Codex output, particularly around:

* path deletion;
* worktree cleanup;
* process termination;
* Git command construction;
* shell execution;
* HTML escaping;
* Windows path behavior;
* signal handling.

For normal CLI, report, test, and documentation code, Codex can work with lighter supervision. For destructive filesystem and Git operations, inspect carefully.

# Final recommendation

Use Codex to develop **the complete BranchMesh codebase**, including tests, report, skill, documentation, and release assets.

But operate it like this:

```text
You define and approve the milestone
→ Codex implements it
→ Codex tests and reviews it
→ you manually verify the result
→ commit
→ continue to the next milestone
```

Do not start with the full interface. Begin immediately with the isolated two-branch vertical slice. Once that reliably detects the prepared hidden conflict without touching the original repository, the hardest and most valuable part of BranchMesh is already proven.

[1]: https://developers.openai.com/codex/build-skills?utm_source=chatgpt.com "Build skills | ChatGPT Learn"
[2]: https://openai.com/index/gpt-5-6/?utm_source=chatgpt.com "GPT-5.6: Frontier intelligence that scales with your ambition"
[3]: https://developers.openai.com/codex/subagents?utm_source=chatgpt.com "Subagents | ChatGPT Learn - OpenAI Developers"
[4]: https://developers.openai.com/codex/agent-configuration/agents-md?utm_source=chatgpt.com "Custom instructions with AGENTS.md | ChatGPT Learn"
