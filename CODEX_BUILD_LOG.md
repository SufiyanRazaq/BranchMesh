# Codex Build Log

## 2026-07-17 — Repository foundation

- **Status:** Complete
- **Scope:** Repository governance, documentation, package tooling, directory boundaries, and a
  minimal compile-only CLI.

Codex work:

- Preserved and clarified the authoritative product and workflow document paths.
- Translated the approved architecture and six locked decisions into repository guidance.
- Prepared the Node.js and TypeScript tooling foundation.
- Deliberately excluded scan, Git worktree, report UI, and complete command implementation.

Human decisions:

- Locked external report storage and OS-temporary execution storage.
- Locked primary versus technical classifications and exit-code meanings.
- Locked non-fail-fast behavior, pair skipping, and the invalid-base stop rule.
- Locked macOS, Linux, and WSL support and unsupported repository features.
- Locked the internal argv boundary and sole configured-command shell boundary.

Verification:

- `npm install` — passed.
- `npm run format:check` — passed after formatting the new product-contract summary; the two moved
  source documents remained byte-for-byte unchanged.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, one foundation test.
- `npm run build` — passed after pinning TypeScript 5.9 for tsup declaration-build
  compatibility.
- `npm run verify` — passed, including the deliberately minimal placeholder demo.

Advisory review:

- `npm audit` reports one low-severity advisory in development-only `esbuild` 0.27.7 through tsup
  and Vitest. It concerns the esbuild development server on native Windows; BranchMesh does not run
  that server and native Windows is outside the MVP, but the advisory remains open until upstream
  tooling accepts esbuild 0.28.1 or later.

Repository actions:

- No commit, push, publication, tag, or release was performed.
