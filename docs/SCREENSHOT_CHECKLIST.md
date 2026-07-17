# Screenshot capture checklist

Capture screenshots only from a newly run real demo. Do not mock classifications, commit IDs,
terminal output, or report contents.

## Required captures

- [ ] Terminal progress plus final compatibility matrix.
- [ ] Offline HTML summary cards and full three-branch matrix.
- [ ] The failing pair visibly labeled `BEHAVIORAL_CONFLICT` and `PAIR_TEST_FAILURE`.
- [ ] Evidence showing both branches passed individually and the combined `node --test` failed.
- [ ] Full captured SHAs, empty conflicted-file evidence, command exit code, and bounded output.
- [ ] A passing pair visibly labeled “No detected conflict.”
- [ ] The limitations/evidence-boundary panel.
- [ ] Codex's result explanation, only after actual repository-skill discovery succeeds.
- [ ] Optional architecture/safety documentation image if the submission accepts explanatory
      captures.

## Privacy and accuracy review

- [ ] Crop usernames, personal paths, unrelated repositories, terminal history, notifications,
      email addresses, tokens, and other credentials.
- [ ] Review retained branch names, file names, commands, SHAs, and command output before sharing.
- [ ] Confirm each image comes from the current `0.1.0` demo/report.
- [ ] Do not imply that a screenshot proves screen-reader support or Linux/WSL execution.
- [ ] Do not show a fabricated fix or a green rerun that is not part of the verified demo.
- [ ] Use no copyrighted artwork, music, or unnecessary third-party branding.

## Presentation

- [ ] Use consistent terminal dimensions and readable font size.
- [ ] Keep the relevant classification and evidence in frame.
- [ ] Add concise captions or alt text when the submission surface supports them.
- [ ] Export at a readable resolution without editing the underlying evidence.
