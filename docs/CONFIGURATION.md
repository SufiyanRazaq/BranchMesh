# BranchMesh configuration reference

BranchMesh loads `branchmesh.config.json` from the canonical Git repository root, even when the
command starts in a subdirectory. The file must be a regular, non-symlink JSON file. Zod validates
it strictly: unknown keys, duplicate IDs, invalid ranges, and unsupported values are errors.

## Complete example

```json
{
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
      "label": "Type checking",
      "kind": "typecheck",
      "command": "npm run typecheck",
      "timeoutMs": 120000
    }
  ],
  "execution": {
    "maxBranches": 5,
    "concurrency": 2,
    "failFast": false,
    "skipPairsWithFailedBranches": true,
    "ignoreDirty": false,
    "maximumLogBytes": 200000
  }
}
```

`$schema` is accepted as a non-empty string for future tooling, but the current package does not
ship a JSON Schema file. The configuration has no `report` block and no environment-value map.

## Top-level fields

### `base`

Required local Git reference, 1–1024 characters. It cannot begin with `-` or contain whitespace or
control characters. The CLI may override it with `--base <ref>`.

### `branches`

Choose exactly one shape.

Explicit local refs:

```json
{
  "branches": ["feature/api", "feature/ui"]
}
```

- 2–5 unique refs;
- no ref may equal `base`;
- the array length cannot exceed `execution.maxBranches`;
- refs are sorted deterministically before planning.

Active-worktree selection:

```json
{
  "branches": {
    "source": "worktrees",
    "include": ["feature/*", "codex/?"],
    "exclude": ["feature/experimental*"]
  }
}
```

- `source` must be `worktrees`;
- `include` defaults to `["*"]` and accepts at most 100 patterns;
- `exclude` defaults to `[]` and accepts at most 100 patterns;
- `*` matches any sequence and `?` matches one character;
- detached worktrees and the configured base are not selected;
- selection must yield at least two and no more than the configured maximum.

`--branches` replaces configured selection with explicit refs. `--worktrees` requests active
worktree discovery. They cannot be combined.

### `setup`

Optional command run before validations in every fresh job worktree:

| Field       | Contract                                     |
| ----------- | -------------------------------------------- |
| `command`   | Nonblank string, maximum 16,384 characters   |
| `timeoutMs` | Integer from 1 to 3,600,000; default 300,000 |

Setup stops that job's pipeline on failure or timeout.

### `commands`

Required ordered array of 1–50 validation commands:

| Field       | Contract                                                 |
| ----------- | -------------------------------------------------------- |
| `id`        | Unique `[A-Za-z0-9][A-Za-z0-9._-]*`; `setup` is reserved |
| `label`     | Trimmed nonblank text, maximum 256 characters            |
| `kind`      | `test`, `typecheck`, `lint`, `build`, or `custom`        |
| `command`   | Nonblank string, maximum 16,384 characters               |
| `timeoutMs` | Integer from 1 to 3,600,000; default 120,000             |

Commands run sequentially in listed order after setup. Each job stops at its first failed or timed
out command. The `kind` determines branch and pair technical classification.

### `execution`

The entire object has defaults when omitted.

| Field                         | Range and default                  | MVP rule                                                            |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `maxBranches`                 | 2–5; default `5`                   | Hard cap on selected branches                                       |
| `concurrency`                 | 1–2; default `2`                   | Result order remains deterministic                                  |
| `failFast`                    | exactly `false`                    | All planned independent work continues                              |
| `skipPairsWithFailedBranches` | exactly `true`                     | Every such pair is stored as `PAIR_SKIPPED`                         |
| `ignoreDirty`                 | boolean; default `false`           | `true` scans only captured commits and excludes uncommitted content |
| `maximumLogBytes`             | 1,024–5,000,000; default `200,000` | Bounded stdout/stderr embedded in result evidence                   |

The Codex skill is deliberately stricter than the general CLI and refuses to scan when
`execution.ignoreDirty` is `true`.

## Command execution boundary

Setup and validation strings are passed unchanged to the platform shell inside owned temporary
worktrees. Branch refs, paths, environment values, and other dynamic data are never concatenated
into those strings. Internal Git and operating-system commands use executable-plus-argv with
`shell: false`.

BranchMesh itself makes no runtime HTTP request. Configured commands are programs chosen by the
repository and may install dependencies, use credentials, or access the network. Review them
before running doctor or scan.

## What `branchmesh init` detects

`init` reads root `package.json`, its optional `packageManager`, and these lockfiles:

- `package-lock.json` or `npm-shrinkwrap.json`;
- `pnpm-lock.yaml`;
- `yarn.lock`;
- `bun.lock` or `bun.lockb`.

It recognizes fixed script names: `test`; `typecheck`, `type-check`, or `check:types`; `lint`; and
`build`. It selects `main`, then `master`, then the current attached branch as the base. A matching
lockfile adds a frozen setup command. Conflicting manager lockfiles require an explicit
`packageManager` declaration. `init` never overwrites an existing regular config without
`--force` and refuses symlink or non-file targets.

Always inspect the generated commands before scanning.
