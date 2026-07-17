import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertGitSuccess, GitClient, type GitCommandResult } from "../../src/git/GitClient.js";
import { parseWorktreePorcelainZ } from "../../src/git/WorktreeParser.js";
import { isPathInside } from "../../src/utils/paths.js";

const fixturePrefix = "branchmesh-test-repository-";
const fixtureMarkerName = ".branchmesh-test-owner.json";
const fixedCommitEnvironment: NodeJS.ProcessEnv = {
  GIT_AUTHOR_DATE: "2026-07-17T10:00:00Z",
  GIT_AUTHOR_EMAIL: "branchmesh-test@local",
  GIT_AUTHOR_NAME: "BranchMesh Test",
  GIT_COMMITTER_DATE: "2026-07-17T10:00:00Z",
  GIT_COMMITTER_EMAIL: "branchmesh-test@local",
  GIT_COMMITTER_NAME: "BranchMesh Test",
};

export interface TemporaryGitRepositoryOptions {
  readonly repositoryDirectoryName?: string | undefined;
  readonly baseFiles?: Readonly<Record<string, string>> | undefined;
}

interface FixtureMarker {
  readonly owner: "branchmesh-test";
  readonly token: string;
}

interface FileState {
  readonly path: string;
  readonly type: "file" | "missing" | "symlink";
  readonly mode: number | null;
  readonly content: string | null;
}

export interface RepositoryState {
  readonly branch: string;
  readonly head: string;
  readonly index: string;
  readonly refs: string;
  readonly status: string;
  readonly trackedFiles: readonly FileState[];
  readonly untrackedFiles: readonly FileState[];
  readonly worktrees: string;
  readonly worktreeAdministrativeEntries: readonly string[];
}

export class TemporaryGitRepository {
  public readonly root: string;
  public readonly repositoryPath: string;
  public readonly commonGitDirectory: string;
  public readonly outputDirectory: string;

  readonly #git = new GitClient();
  readonly #marker: FixtureMarker;
  readonly #fixtureHooksDirectory: string;
  readonly #linkedWorktrees = new Set<string>();
  #cleaned = false;

  private constructor(
    root: string,
    repositoryPath: string,
    commonGitDirectory: string,
    marker: FixtureMarker,
  ) {
    this.root = root;
    this.repositoryPath = repositoryPath;
    this.commonGitDirectory = commonGitDirectory;
    this.outputDirectory = path.join(root, "scan-output");
    this.#marker = marker;
    this.#fixtureHooksDirectory = path.join(root, "fixture-hooks");
  }

  public static async create(
    options: TemporaryGitRepositoryOptions = {},
  ): Promise<TemporaryGitRepository> {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), fixturePrefix)));
    const marker: FixtureMarker = { owner: "branchmesh-test", token: randomUUID() };
    const repositoryPath = path.join(root, options.repositoryDirectoryName ?? "repository");

    try {
      await chmod(root, 0o700);
      await writeFile(path.join(root, fixtureMarkerName), `${JSON.stringify(marker)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await mkdir(path.join(root, "fixture-hooks"), { mode: 0o700 });

      const git = new GitClient();
      assertGitSuccess(
        await git.run(["init", "--initial-branch=main", repositoryPath], { cwd: root }),
        "Test repository initialization",
      );
      const commonGitDirectory = await realpath(path.join(repositoryPath, ".git"));
      const repository = new TemporaryGitRepository(
        root,
        repositoryPath,
        commonGitDirectory,
        marker,
      );

      for (const [key, value] of [
        ["core.autocrlf", "false"],
        ["core.fileMode", "false"],
        ["core.safecrlf", "false"],
      ] as const) {
        await repository.runGit(["config", "--local", key, value]);
      }
      await repository.writeFiles(options.baseFiles ?? { "base.txt": "base\n" });
      await repository.commit("Create base");
      return repository;
    } catch (error: unknown) {
      await removeUninitializedFixtureRoot(root);
      throw error;
    }
  }

  public async runGit(
    args: readonly string[],
    environment?: NodeJS.ProcessEnv,
  ): Promise<GitCommandResult> {
    return assertGitSuccess(
      await this.#git.run(
        [
          "-c",
          `core.hooksPath=${this.#fixtureHooksDirectory}`,
          "-c",
          "commit.gpgSign=false",
          "-C",
          this.repositoryPath,
          ...args,
        ],
        {
          cwd: this.root,
          ...(environment === undefined ? {} : { env: environment }),
        },
      ),
      `Fixture Git command (${args[0] ?? "missing"})`,
    );
  }

  public async runGitAllowFailure(args: readonly string[]): Promise<GitCommandResult> {
    return await this.#git.run(
      [
        "-c",
        `core.hooksPath=${this.#fixtureHooksDirectory}`,
        "-c",
        "commit.gpgSign=false",
        "-C",
        this.repositoryPath,
        ...args,
      ],
      { cwd: this.root },
    );
  }

  public async writeFiles(files: Readonly<Record<string, string>>): Promise<void> {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = this.#fixturePath(relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }
  }

  public async removeFiles(relativePaths: readonly string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      await rm(this.#fixturePath(relativePath));
    }
  }

  public async commit(message: string): Promise<string> {
    await this.runGit(["add", "--all"]);
    await this.runGit(["commit", "--message", message], fixedCommitEnvironment);
    return await this.resolveCommit("HEAD");
  }

  public async createBranch(
    reference: string,
    files: Readonly<Record<string, string>>,
    startReference = "main",
  ): Promise<string> {
    await this.runGit(["switch", "--create", reference, startReference]);
    await this.writeFiles(files);
    const commit = await this.commit(`Create ${reference}`);
    await this.runGit(["switch", "main"]);
    return commit;
  }

  public async resolveCommit(reference: string): Promise<string> {
    return (await this.runGit(["rev-parse", "--verify", `${reference}^{commit}`])).stdout
      .trim()
      .toLowerCase();
  }

  public async addWorktree(directoryName: string, reference: string): Promise<string> {
    const worktreePath = this.#rootPath(directoryName);
    await this.runGit(["worktree", "add", worktreePath, reference]);
    this.#linkedWorktrees.add(worktreePath);
    return worktreePath;
  }

  public async removeWorktree(worktreePath: string): Promise<void> {
    const canonicalPath = path.resolve(worktreePath);
    if (!this.#linkedWorktrees.has(canonicalPath)) {
      throw new Error(`Test worktree is not owned by this fixture: ${canonicalPath}`);
    }
    const removal = await this.runGitAllowFailure(["worktree", "remove", "--force", canonicalPath]);
    if (removal.exitCode !== 0) {
      throw new Error(removal.stderr.trim() || "Fixture worktree removal failed");
    }
    this.#linkedWorktrees.delete(canonicalPath);
  }

  public async listWorktrees(): Promise<string[]> {
    const result = await this.runGit(["worktree", "list", "--porcelain", "-z"]);
    return parseWorktreePorcelainZ(result.stdout).map((worktree) => path.resolve(worktree.path));
  }

  public async captureState(): Promise<RepositoryState> {
    return await this.#captureStateAt(this.repositoryPath);
  }

  public async captureWorktreeState(worktreePath: string): Promise<RepositoryState> {
    const resolvedPath = path.resolve(worktreePath);
    if (!isPathInside(this.root, resolvedPath)) {
      throw new Error(`Test worktree escaped its owned fixture root: ${resolvedPath}`);
    }
    return await this.#captureStateAt(resolvedPath);
  }

  async #captureStateAt(worktreePath: string): Promise<RepositoryState> {
    const atWorktree = (args: readonly string[]): readonly string[] => [
      "-C",
      worktreePath,
      ...args,
    ];
    const branch = (await this.runGit(atWorktree(["symbolic-ref", "--quiet", "--short", "HEAD"])))
      .stdout;
    const head = (await this.runGit(atWorktree(["rev-parse", "HEAD"]))).stdout;
    const status = (
      await this.runGit(atWorktree(["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
    ).stdout;
    const refs = (
      await this.runGit(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)"])
    ).stdout;
    const tracked = splitNull(
      (await this.runGit(atWorktree(["ls-files", "--cached", "-z"]))).stdout,
    );
    const untracked = splitNull(
      (await this.runGit(atWorktree(["ls-files", "--others", "--exclude-standard", "-z"]))).stdout,
    );
    const indexOutput = (
      await this.runGit(atWorktree(["rev-parse", "--path-format=absolute", "--git-path", "index"]))
    ).stdout.trim();
    const worktrees = (await this.runGit(["worktree", "list", "--porcelain", "-z"])).stdout;

    return {
      branch,
      head,
      index: (await readFile(indexOutput)).toString("base64"),
      refs,
      status,
      trackedFiles: await this.#captureFiles(worktreePath, tracked),
      untrackedFiles: await this.#captureFiles(worktreePath, untracked),
      worktrees,
      worktreeAdministrativeEntries: await directoryEntriesOrEmpty(
        path.join(this.commonGitDirectory, "worktrees"),
      ),
    };
  }

  public async cleanup(): Promise<void> {
    if (this.#cleaned) {
      return;
    }

    for (const worktreePath of [...this.#linkedWorktrees].reverse()) {
      await this.removeWorktree(worktreePath);
    }
    await assertFixtureRoot(this.root, this.#marker);
    await rm(this.root, { recursive: true });
    this.#cleaned = true;
  }

  async #captureFiles(
    worktreePath: string,
    relativePaths: readonly string[],
  ): Promise<FileState[]> {
    const states: FileState[] = [];
    for (const relativePath of [...relativePaths].sort(compareText)) {
      const filePath = resolveContainedPath(worktreePath, relativePath);
      try {
        const stat = await lstat(filePath);
        if (stat.isSymbolicLink()) {
          states.push({
            path: relativePath,
            type: "symlink",
            mode: stat.mode,
            content: await readlink(filePath),
          });
        } else {
          states.push({
            path: relativePath,
            type: "file",
            mode: stat.mode,
            content: (await readFile(filePath)).toString("base64"),
          });
        }
      } catch (error: unknown) {
        if (isNodeError(error) && error.code === "ENOENT") {
          states.push({ path: relativePath, type: "missing", mode: null, content: null });
        } else {
          throw error;
        }
      }
    }
    return states;
  }

  #fixturePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error("Fixture file paths must be relative");
    }
    const candidate = path.resolve(this.repositoryPath, relativePath);
    if (!isPathInside(this.repositoryPath, candidate)) {
      throw new Error(`Fixture file path escaped the repository: ${relativePath}`);
    }
    return candidate;
  }

  #rootPath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error("Fixture root paths must be relative");
    }
    const candidate = path.resolve(this.root, relativePath);
    if (!isPathInside(this.root, candidate)) {
      throw new Error(`Fixture path escaped its owned root: ${relativePath}`);
    }
    return candidate;
  }
}

async function assertFixtureRoot(root: string, expectedMarker: FixtureMarker): Promise<void> {
  const canonicalTemporaryDirectory = await realpath(os.tmpdir());
  if (
    !isPathInside(canonicalTemporaryDirectory, root) ||
    !path.basename(root).startsWith(fixturePrefix)
  ) {
    throw new Error("Refusing to remove an invalid test repository root");
  }

  const marker: unknown = JSON.parse(await readFile(path.join(root, fixtureMarkerName), "utf8"));
  if (
    !isRecord(marker) ||
    marker["owner"] !== expectedMarker.owner ||
    marker["token"] !== expectedMarker.token
  ) {
    throw new Error("Test repository ownership marker does not match");
  }
}

async function removeUninitializedFixtureRoot(root: string): Promise<void> {
  const canonicalTemporaryDirectory = await realpath(os.tmpdir());
  if (
    !isPathInside(canonicalTemporaryDirectory, root) ||
    !path.basename(root).startsWith(fixturePrefix)
  ) {
    throw new Error("Refusing to remove an invalid test repository root");
  }
  await rm(root, { recursive: true });
}

async function directoryEntriesOrEmpty(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).sort(compareText);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function splitNull(value: string): string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

function resolveContainedPath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("Captured file paths must be relative");
  }
  const candidate = path.resolve(root, relativePath);
  if (!isPathInside(root, candidate)) {
    throw new Error(`Captured file path escaped its worktree: ${relativePath}`);
  }
  return candidate;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
