# BranchMesh skill troubleshooting

Use only safe, non-mutating remedies while this skill is active. Never bypass a dirty-worktree or
ownership refusal and never run cleanup automatically.

| Symptom or exit                              | Safe response                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing `dist/cli.js` or `dist/contracts.js` | Stop and ask the user to run `npm run build` in the BranchMesh checkout. Never download a replacement.                                        |
| Missing or invalid configuration, exit `2`   | Explain the exact field error. Suggest `branchmesh init` only as a separate, user-approved write, or ask the user to edit the config.         |
| Fewer than two selected branches             | Ask for two to five explicit local refs, or confirm active-worktree/configured selection.                                                     |
| Dirty or unsupported state, exit `4`         | Ask the user to commit or otherwise resolve the state. Do not pass `--ignore-dirty`. Native Windows, submodules, and Git LFS are unsupported. |
| Config has `execution.ignoreDirty: true`     | Stop before scan and ask the user to set it to `false`. The skill does not scan while a dirt bypass is enabled.                               |
| Invalid base, scan exit `3`                  | Explain the base classification and failed command. State that branch and pair jobs did not run.                                              |
| Individual failure and `PAIR_SKIPPED`        | Explain the individual failure; the skipped pair has no compatibility evidence.                                                               |
| Timeout                                      | Report the partial redacted evidence. Suggest reviewing that command's `timeoutMs`; do not change it automatically.                           |
| Missing executable                           | Report the doctor/configuration error. Do not install packages or invoke `npx`.                                                               |
| Output-path or publication error             | Ask for a fresh external `--output` directory or use the CLI default. Never choose a path inside a repository or worktree.                    |
| Interruption, exit `130`                     | Report interruption and wait for the CLI cleanup to finish. Do not force-delete its execution root.                                           |
| `--open` fails in a headless environment     | The skill never uses `--open`; provide the printed HTML path for manual opening.                                                              |

Exit `1` is not an infrastructure error: the scan completed and published validated evidence of
an incompatibility. The wrapper returns `0` after validating such a result and exposes the actual
value as `scanExitCode`.
