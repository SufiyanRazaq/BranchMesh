# Supported platforms

## Runtime requirements

- Node.js 20 or newer.
- Git 2.31.0 or newer.
- A local JavaScript or TypeScript Git worktree.
- POSIX process-group and filesystem behavior.

## Support matrix

| Environment    | MVP status                  | Evidence                                                                                                                |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| macOS          | Supported                   | Complete development, real-Git, process, cleanup, demo, report, CLI, and skill suites run in this session.              |
| Linux          | Supported by implementation | Runtime gate, path/storage behavior, and POSIX process model are implemented; release-matrix execution remains pending. |
| WSL            | Supported as Linux          | Uses the Linux code path; release-matrix execution remains pending.                                                     |
| Native Windows | Unsupported                 | Doctor/preflight rejects `win32`; Windows worktree and process cleanup are not certified.                               |

Do not interpret “supported by implementation” as a claim that the current session ran on Linux or
WSL. Those executions remain a final-release gate.

## Unsupported repository features

The MVP rejects:

- Git submodules;
- repositories using Git LFS;
- non-worktree/bare repository invocation;
- remote refs as an integration source;
- snapshots of uncommitted content.

Submodules and Git LFS are excluded until their setup, worktree, object availability, and cleanup
behavior has dedicated tests.

## Ecosystem scope

The CLI can run arbitrary configured command strings, but setup generation and the documented MVP
experience target JavaScript and TypeScript projects using npm, pnpm, Yarn, or Bun. The BranchMesh
repository itself uses npm.

BranchMesh performs no remote fetch. All selected refs and required objects must already exist in
the local repository.

## Optional platform utilities

`--open` requires:

- `open` on macOS;
- `xdg-open` on Linux/WSL.

Report generation does not depend on either utility. In headless environments, omit `--open` and
use the printed HTML path. The report is self-contained and makes no runtime request.

## Filesystem expectations

Execution and ownership proofs depend on supported-platform behavior for canonical paths,
`O_NOFOLLOW`, regular-file metadata, atomic rename/link publication, and temporary-directory
permissions. Network or unusually permissive filesystems may have different semantics and are not
explicitly certified for the MVP.
