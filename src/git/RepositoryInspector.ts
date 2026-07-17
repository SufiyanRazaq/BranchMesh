import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ScanConfig } from "../config/schema.js";
import { InfrastructureError, UnsupportedRepositoryError } from "../model/errors.js";
import { BranchSnapshotSchema, type BranchSnapshot } from "../model/results.js";
import { isPathInside } from "../utils/paths.js";
import { assertGitSuccess } from "./GitClient.js";
import type { GitClient } from "./GitClient.js";
import { parseWorktreePorcelainZ, type DiscoveredWorktree } from "./WorktreeParser.js";

const MINIMUM_GIT_VERSION = [2, 31, 0] as const;
const MINIMUM_NODE_MAJOR = 20;

export interface RepositoryIdentity {
  readonly root: string;
  readonly commonGitDirectory: string;
}

export interface RuntimeVersions {
  readonly nodeVersion: string;
  readonly gitVersion: string;
  readonly platform: "darwin" | "linux";
}

export interface RepositorySnapshot {
  readonly repository: RepositoryIdentity;
  readonly runtime: RuntimeVersions;
  readonly worktrees: readonly DiscoveredWorktree[];
  readonly base: BranchSnapshot;
  readonly branches: readonly BranchSnapshot[];
}

interface UnenrichedSnapshot {
  readonly ref: string;
  readonly fullRef: string | null;
  readonly sha: string;
}

export interface RepositoryInspectorOptions {
  readonly neutralCwd?: string;
  readonly temporaryDirectory?: string;
  readonly nodeVersion?: string;
  readonly platform?: NodeJS.Platform;
}

export class RepositoryInspector {
  readonly #git: GitClient;
  readonly #neutralCwd: string;
  readonly #temporaryDirectory: string;
  readonly #nodeVersion: string;
  readonly #platform: NodeJS.Platform;

  public constructor(git: GitClient, options: RepositoryInspectorOptions | string = {}) {
    const normalizedOptions = typeof options === "string" ? { neutralCwd: options } : options;
    this.#git = git;
    this.#neutralCwd = path.resolve(normalizedOptions.neutralCwd ?? os.tmpdir());
    this.#temporaryDirectory = path.resolve(normalizedOptions.temporaryDirectory ?? os.tmpdir());
    this.#nodeVersion = normalizedOptions.nodeVersion ?? process.versions.node;
    this.#platform = normalizedOptions.platform ?? process.platform;
  }

  public async resolveRepositoryRoot(
    repositoryPath: string,
    signal?: AbortSignal,
  ): Promise<RepositoryIdentity> {
    const requestedPath = path.resolve(repositoryPath);
    const rootResult = assertGitSuccess(
      await this.#git.run(["-C", requestedPath, "rev-parse", "--show-toplevel"], {
        cwd: this.#neutralCwd,
        signal,
      }),
      "Repository-root resolution",
    );
    const root = await realpath(rootResult.stdout.trim());

    const commonDirectoryResult = assertGitSuccess(
      await this.#git.run(["-C", root, "rev-parse", "--git-common-dir"], {
        cwd: this.#neutralCwd,
        signal,
      }),
      "Git common-directory resolution",
    );
    const commonDirectoryOutput = commonDirectoryResult.stdout.trim();
    const commonDirectoryPath = path.isAbsolute(commonDirectoryOutput)
      ? commonDirectoryOutput
      : path.resolve(root, commonDirectoryOutput);

    return { root, commonGitDirectory: await realpath(commonDirectoryPath) };
  }

  public async preflight(
    repositoryPath: string,
    config: ScanConfig,
    signal?: AbortSignal,
  ): Promise<RepositorySnapshot> {
    const runtime = await this.#validateRuntime(signal);
    await this.#verifyTemporaryStorage();
    const repository = await this.resolveRepositoryRoot(repositoryPath, signal);
    const worktrees = await this.#discoverWorktrees(repository, signal);
    const selectedReferences = selectBranchReferences(config, worktrees);

    if (selectedReferences.length < 2) {
      throw new InfrastructureError("At least two branches must be selected for a pair scan");
    }
    if (selectedReferences.length > config.execution.maxBranches) {
      throw new InfrastructureError(
        `Selected ${String(selectedReferences.length)} branches; the configured maximum is ${String(config.execution.maxBranches)}`,
      );
    }

    // Resolve every mutable reference before doing changed-file work or starting any job.
    const baseUnenriched = await this.#resolveBase(repository, config.base, signal);
    const branchUnenriched: UnenrichedSnapshot[] = [];
    for (const reference of selectedReferences) {
      branchUnenriched.push(await this.#resolveLocalBranch(repository, reference, signal));
    }

    const duplicateRefs = findDuplicates(
      branchUnenriched.map((snapshot) => snapshot.fullRef ?? ""),
    );
    if (duplicateRefs.length > 0) {
      throw new InfrastructureError("Selected branches resolve to duplicate local references");
    }
    if (
      baseUnenriched.fullRef !== null &&
      branchUnenriched.some((branch) => branch.fullRef === baseUnenriched.fullRef)
    ) {
      throw new InfrastructureError("A selected branch resolves to the base reference");
    }

    const dirtiness = await this.#inspectSelectedDirtiness(
      repository,
      [baseUnenriched, ...branchUnenriched],
      worktrees,
      signal,
    );
    const dirtySelections = dirtiness.filter((selection) => selection.dirty);
    if (dirtySelections.length > 0 && !config.execution.ignoreDirty) {
      throw new UnsupportedRepositoryError(
        `Selected worktrees are dirty: ${dirtySelections.map((selection) => selection.ref).join(", ")}`,
      );
    }

    const allSnapshots = [baseUnenriched, ...branchUnenriched];
    await this.#assertSupportedTrees(repository, allSnapshots, signal);

    const baseState = dirtiness[0];
    if (baseState === undefined) {
      throw new InfrastructureError("Base dirtiness state was not calculated");
    }
    const base = BranchSnapshotSchema.parse({
      ...baseUnenriched,
      changedFiles: [],
      dirty: baseState.dirty,
      worktreePath: baseState.worktreePath,
    });

    const branches: BranchSnapshot[] = [];
    for (const [index, snapshot] of branchUnenriched.entries()) {
      const state = dirtiness[index + 1];
      if (state === undefined) {
        throw new InfrastructureError(`Dirtiness state is missing for ${snapshot.ref}`);
      }
      branches.push(
        BranchSnapshotSchema.parse({
          ...snapshot,
          changedFiles: await this.#changedFiles(repository, base.sha, snapshot.sha, signal),
          dirty: state.dirty,
          worktreePath: state.worktreePath,
        }),
      );
    }

    return { repository, runtime, worktrees, base, branches };
  }

  async #validateRuntime(signal?: AbortSignal): Promise<RuntimeVersions> {
    if (this.#platform !== "darwin" && this.#platform !== "linux") {
      throw new UnsupportedRepositoryError(
        `Native ${this.#platform} execution is unsupported; use macOS, Linux, or WSL`,
      );
    }
    validateNodeVersion(this.#nodeVersion);

    const versionResult = assertGitSuccess(
      await this.#git.run(["--version"], { cwd: this.#neutralCwd, signal }),
      "Git version validation",
    );
    const gitVersion = validateGitVersion(versionResult.stdout);
    return {
      nodeVersion: normalizeVersion(this.#nodeVersion),
      gitVersion: gitVersion.version,
      platform: this.#platform,
    };
  }

  async #discoverWorktrees(
    repository: RepositoryIdentity,
    signal?: AbortSignal,
  ): Promise<DiscoveredWorktree[]> {
    const result = assertGitSuccess(
      await this.#git.run(
        ["--git-dir", repository.commonGitDirectory, "worktree", "list", "--porcelain", "-z"],
        { cwd: this.#neutralCwd, signal },
      ),
      "Git worktree discovery",
    );
    const parsed = parseWorktreePorcelainZ(result.stdout);
    const canonical: DiscoveredWorktree[] = [];
    for (const worktree of parsed) {
      let worktreePath = path.resolve(worktree.path);
      if (!worktree.prunable) {
        worktreePath = await realpath(worktreePath);
      }
      canonical.push({ ...worktree, path: worktreePath });
    }
    return canonical.sort((left, right) => compareText(left.path, right.path));
  }

  async #resolveBase(
    repository: RepositoryIdentity,
    reference: string,
    signal?: AbortSignal,
  ): Promise<UnenrichedSnapshot> {
    const sha = await this.#resolveCommit(repository, reference, signal);
    const symbolic = await this.#git.run(
      [
        "--git-dir",
        repository.commonGitDirectory,
        "rev-parse",
        "--symbolic-full-name",
        "--verify",
        "--end-of-options",
        reference,
      ],
      { cwd: this.#neutralCwd, signal },
    );
    return {
      ref: reference,
      fullRef:
        symbolic.exitCode === 0 && symbolic.stdout.trim() !== "" ? symbolic.stdout.trim() : null,
      sha,
    };
  }

  async #resolveLocalBranch(
    repository: RepositoryIdentity,
    reference: string,
    signal?: AbortSignal,
  ): Promise<UnenrichedSnapshot> {
    const fullRef = reference.startsWith("refs/heads/") ? reference : `refs/heads/${reference}`;
    const sha = await this.#resolveCommit(repository, fullRef, signal);
    return { ref: fullRef.slice("refs/heads/".length), fullRef, sha };
  }

  async #resolveCommit(
    repository: RepositoryIdentity,
    reference: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = assertGitSuccess(
      await this.#git.run(
        [
          "--git-dir",
          repository.commonGitDirectory,
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${reference}^{commit}`,
        ],
        { cwd: this.#neutralCwd, signal },
      ),
      `Commit resolution for ${reference}`,
    );
    return result.stdout.trim().toLowerCase();
  }

  async #inspectSelectedDirtiness(
    repository: RepositoryIdentity,
    snapshots: readonly UnenrichedSnapshot[],
    worktrees: readonly DiscoveredWorktree[],
    signal?: AbortSignal,
  ): Promise<Array<{ ref: string; dirty: boolean; worktreePath: string | null }>> {
    const states: Array<{ ref: string; dirty: boolean; worktreePath: string | null }> = [];
    for (const snapshot of snapshots) {
      const matching = worktrees.filter(
        (worktree) => snapshot.fullRef !== null && worktree.branch === snapshot.fullRef,
      );
      let dirty = false;
      for (const worktree of matching) {
        if (worktree.prunable) {
          throw new UnsupportedRepositoryError(
            `Selected worktree for ${snapshot.ref} is prunable and cannot be inspected safely`,
          );
        }
        const status = assertGitSuccess(
          await this.#git.run(
            ["-C", worktree.path, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
            { cwd: this.#neutralCwd, signal },
          ),
          `Dirty-state inspection for ${snapshot.ref}`,
        );
        dirty ||= status.stdout.length > 0;
      }
      states.push({
        ref: snapshot.ref,
        dirty,
        worktreePath: matching[0]?.path ?? null,
      });
    }
    return states;
  }

  async #changedFiles(
    repository: RepositoryIdentity,
    baseSha: string,
    branchSha: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const result = assertGitSuccess(
      await this.#git.run(
        [
          "--git-dir",
          repository.commonGitDirectory,
          "diff",
          "--name-only",
          "-z",
          baseSha,
          branchSha,
          "--",
        ],
        { cwd: this.#neutralCwd, signal },
      ),
      "Changed-file calculation",
    );
    return result.stdout.split("\0").filter(Boolean).sort(compareText);
  }

  async #assertSupportedTrees(
    repository: RepositoryIdentity,
    snapshots: readonly UnenrichedSnapshot[],
    signal?: AbortSignal,
  ): Promise<void> {
    const checked = new Set<string>();
    for (const snapshot of snapshots) {
      if (checked.has(snapshot.sha)) {
        continue;
      }
      checked.add(snapshot.sha);
      const tree = assertGitSuccess(
        await this.#git.run(
          ["--git-dir", repository.commonGitDirectory, "ls-tree", "-r", "-z", snapshot.sha],
          { cwd: this.#neutralCwd, signal },
        ),
        `Repository feature inspection for ${snapshot.ref}`,
      );
      const attributePaths: string[] = [];
      for (const record of tree.stdout.split("\0").filter(Boolean)) {
        const tab = record.indexOf("\t");
        if (tab === -1) {
          throw new InfrastructureError("Git returned a malformed tree entry");
        }
        const metadata = record.slice(0, tab).split(" ");
        const filePath = record.slice(tab + 1);
        if (metadata[0] === "160000") {
          throw new UnsupportedRepositoryError(
            "Repositories containing submodules are unsupported",
          );
        }
        if (path.posix.basename(filePath) === ".lfsconfig") {
          throw new UnsupportedRepositoryError("Repositories using Git LFS are unsupported");
        }
        if (path.posix.basename(filePath) === ".gitattributes") {
          attributePaths.push(filePath);
        }
      }

      for (const attributePath of attributePaths) {
        const attributes = assertGitSuccess(
          await this.#git.run(
            [
              "--git-dir",
              repository.commonGitDirectory,
              "show",
              `${snapshot.sha}:${attributePath}`,
            ],
            { cwd: this.#neutralCwd, signal },
          ),
          `Git attributes inspection for ${snapshot.ref}`,
        );
        const usesLfs = attributes.stdout
          .split(/\r?\n/u)
          .some((line) => !line.trimStart().startsWith("#") && /\bfilter\s*=\s*lfs\b/u.test(line));
        if (usesLfs) {
          throw new UnsupportedRepositoryError("Repositories using Git LFS are unsupported");
        }
      }
    }
  }

  async #verifyTemporaryStorage(): Promise<void> {
    const canonicalTemporaryDirectory = await realpath(this.#temporaryDirectory);
    const probe = await realpath(
      await mkdtemp(path.join(canonicalTemporaryDirectory, "branchmesh-preflight-")),
    );
    let operationError: unknown;
    try {
      if (!isPathInside(canonicalTemporaryDirectory, probe)) {
        throw new InfrastructureError("Temporary-storage probe escaped os.tmpdir()");
      }
      await chmod(probe, 0o700);
      const probeFile = path.join(probe, ".branchmesh-preflight");
      await writeFile(probeFile, "branchmesh\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      if ((await readFile(probeFile, "utf8")) !== "branchmesh\n") {
        throw new InfrastructureError("Temporary-storage probe could not be read back");
      }
    } catch (error: unknown) {
      operationError = error;
    }

    try {
      const stat = await lstat(probe);
      if (
        stat.isSymbolicLink() ||
        !path.basename(probe).startsWith("branchmesh-preflight-") ||
        !isPathInside(canonicalTemporaryDirectory, probe)
      ) {
        throw new InfrastructureError("Refusing to clean an unowned temporary-storage probe");
      }
      await rm(probe, { recursive: true });
    } catch (cleanupError: unknown) {
      if (operationError !== undefined) {
        throw new AggregateError(
          [operationError, cleanupError],
          "Temporary-storage validation and cleanup both failed",
        );
      }
      throw cleanupError;
    }
    if (operationError !== undefined) {
      throw operationError instanceof Error
        ? operationError
        : new Error("Temporary-storage validation failed with a non-Error value");
    }
  }
}

export function parseGitVersion(output: string): { version: string; parts: readonly number[] } {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/u.exec(output.trim());
  if (match === null) {
    throw new UnsupportedRepositoryError(`Could not parse Git version output: ${output.trim()}`);
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")] as const;
  return { version: parts.join("."), parts };
}

export function validateGitVersion(output: string): { version: string; parts: readonly number[] } {
  const parsed = parseGitVersion(output);
  validateMinimumVersion(parsed.parts, MINIMUM_GIT_VERSION, "Git");
  return parsed;
}

export function validateNodeVersion(version: string): void {
  const normalized = normalizeVersion(version);
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(normalized);
  if (match === null) {
    throw new UnsupportedRepositoryError(`Could not parse Node.js version: ${version}`);
  }
  if (Number(match[1]) < MINIMUM_NODE_MAJOR) {
    throw new UnsupportedRepositoryError(
      `Node.js ${String(MINIMUM_NODE_MAJOR)} or newer is required; found ${normalized}`,
    );
  }
}

function validateMinimumVersion(
  actual: readonly number[],
  minimum: readonly number[],
  label: string,
): void {
  for (let index = 0; index < Math.max(actual.length, minimum.length); index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart > minimumPart) {
      return;
    }
    if (actualPart < minimumPart) {
      throw new UnsupportedRepositoryError(
        `${label} ${minimum.join(".")} or newer is required; found ${actual.join(".")}`,
      );
    }
  }
}

function selectBranchReferences(
  config: ScanConfig,
  worktrees: readonly DiscoveredWorktree[],
): string[] {
  if (Array.isArray(config.branches)) {
    return [...config.branches].sort(compareText);
  }

  const selected = new Set<string>();
  const baseReference = config.base.startsWith("refs/heads/")
    ? config.base.slice("refs/heads/".length)
    : config.base;
  for (const worktree of worktrees) {
    if (worktree.branch?.startsWith("refs/heads/") !== true) {
      continue;
    }
    const reference = worktree.branch.slice("refs/heads/".length);
    if (reference === baseReference) {
      continue;
    }
    const included = config.branches.include.some((pattern) => matchesPattern(reference, pattern));
    const excluded = config.branches.exclude.some((pattern) => matchesPattern(reference, pattern));
    if (included && !excluded) {
      selected.add(reference);
    }
  }
  return [...selected].sort(compareText);
}

function matchesPattern(value: string, pattern: string): boolean {
  let valueIndex = 0;
  let patternIndex = 0;
  let starIndex = -1;
  let starMatchIndex = 0;

  while (valueIndex < value.length) {
    const patternCharacter = pattern[patternIndex];
    if (patternCharacter === "?" || patternCharacter === value[valueIndex]) {
      valueIndex += 1;
      patternIndex += 1;
    } else if (patternCharacter === "*") {
      starIndex = patternIndex;
      starMatchIndex = valueIndex;
      patternIndex += 1;
    } else if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      starMatchIndex += 1;
      valueIndex = starMatchIndex;
    } else {
      return false;
    }
  }
  while (pattern[patternIndex] === "*") {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
