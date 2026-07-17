# Demo recording checklist

## Before recording

- [ ] Use a clean checkout/source extraction that passed the release checklist.
- [ ] Confirm Node.js 20+ and Git 2.31+.
- [ ] Build before the visible segment so compilation noise does not consume the video.
- [ ] Disable notifications and close unrelated windows, terminals, and repositories.
- [ ] Create a fresh external report directory; never reuse one containing artifacts.
- [ ] Confirm no sensitive values appear in terminal history or the generated report.
- [ ] Confirm the real Codex host discovers the skill before planning to show it.
- [ ] Confirm the primary-session model metadata before naming GPT-5.6.

## During recording

- [ ] Run `node dist/cli.js demo --output <fresh-external-directory>` without `--open`.
- [ ] Explain that direct demo exit `1` is the expected incompatibility signal.
- [ ] Show `BASE_PASS`, three `BRANCH_PASS` results, one behavioral conflict, two “No detected
      conflict” pairs, and zero textual conflicts.
- [ ] Open the newly generated local `report.html` manually.
- [ ] Activate the failing matrix cell and show failed-command evidence and full captured SHAs.
- [ ] State that the report covers committed tips, configured commands, pairs, and one merge order.
- [ ] Show the Codex explanation only if actual skill discovery was verified.
- [ ] Do not show an automatic fix; BranchMesh does not implement fixes.
- [ ] Keep the spoken English script under three minutes with clear audio.

## After recording

- [ ] Check that no frame exposes a personal path, notification, token, or unrelated content.
- [ ] Verify audio intelligibility, captions, and final duration.
- [ ] Upload to the required public video host without copyrighted music.
- [ ] Test the video while logged out.
- [ ] Add the verified public URL to Devpost.
