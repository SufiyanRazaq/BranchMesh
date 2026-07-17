import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { assertGitSuccess } from "../git/GitClient.js";
import type { GitClient, GitCommandOptions, GitCommandResult } from "../git/GitClient.js";
import type { RepositoryIdentity } from "../git/RepositoryInspector.js";
import { parseWorktreePorcelainZ } from "../git/WorktreeParser.js";
import { isPathInside } from "../utils/paths.js";
import {
  executionWorktreePath,
  type ExecutionOwnership,
  type WorktreeRecord,
} from "./ownership.js";

export class WorktreeManager {
  readonly #git: GitClient;
  readonly #repository: RepositoryIdentity;
  readonly #ownership: ExecutionOwnership;
  readonly #signal: AbortSignal | undefined;
  #gitAdministrationTail: Promise<void> = Promise.resolve();
  #cleaned = false;

  public constructor(
    git: GitClient,
    repository: RepositoryIdentity,
    ownership: ExecutionOwnership,
    signal?: AbortSignal,
  ) {
    this.#git = git;
    this.#repository = repository;
    this.#ownership = ownership;
    this.#signal = signal;
  }

  public get executionRoot(): string {
    return this.#ownership.root;
  }

  public async create(jobId: string, baseSha: string): Promise<string> {
    const worktreePath = executionWorktreePath(this.#ownership.root, jobId);
    const jobDirectory = path.dirname(worktreePath);
    await mkdir(jobDirectory, { mode: 0o700 });
    await this.#ownership.registerWorktree(jobId, worktreePath);

    const result = await this.#runGitAdministration(
      [
        "--git-dir",
        this.#repository.commonGitDirectory,
        "-c",
        `core.hooksPath=${this.#ownership.hooksDirectory}`,
        "worktree",
        "add",
        "--detach",
        worktreePath,
        baseSha,
      ],
      { cwd: this.#ownership.root, signal: this.#signal },
    );
    assertGitSuccess(result, `Detached worktree creation for ${jobId}`);
    await this.#ownership.updateWorktree(jobId, { state: "active", activity: "idle" });
    return worktreePath;
  }

  public async cleanup(jobId: string): Promise<void> {
    if (this.#cleaned) {
      return;
    }

    const record = this.#ownership.findWorktree(jobId);
    if (record === undefined || record.state === "removed") {
      return;
    }

    await this.#ownership.verify();
    await this.#ownership.updateWorktree(jobId, { activity: "git" });

    const registeredPaths = await this.listRepositoryWorktrees();
    if (registeredPaths.includes(record.path)) {
      await this.#ownership.assertOwnedPath(record.path);
      const removal = await this.#runGitAdministration(
        [
          "--git-dir",
          this.#repository.commonGitDirectory,
          "worktree",
          "remove",
          "--force",
          record.path,
        ],
        { cwd: this.#ownership.root },
      );
      assertGitSuccess(removal, `Worktree removal for ${jobId}`);
    }

    const remainingPaths = await this.listRepositoryWorktrees();
    if (remainingPaths.includes(record.path)) {
      throw new Error(`Git still lists BranchMesh worktree ${record.path}`);
    }

    const jobDirectory = path.dirname(record.path);
    if (await pathExists(jobDirectory)) {
      await this.#ownership.assertOwnedPath(jobDirectory);
      await rm(jobDirectory, { recursive: true });
    }
    await this.#ownership.updateWorktree(jobId, { state: "removed", activity: "idle" });
  }

  public async setActivity(jobId: string, activity: WorktreeRecord["activity"]): Promise<void> {
    await this.#ownership.updateWorktree(jobId, { activity });
  }

  public async cleanupAll(): Promise<void> {
    if (this.#cleaned) {
      return;
    }

    const errors: unknown[] = [];
    for (const record of [...this.#ownership.worktrees].reverse()) {
      try {
        await this.cleanup(record.jobId);
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more BranchMesh worktrees could not be cleaned up");
    }

    const remainingOwnedWorktrees = (await this.listRepositoryWorktrees()).filter((worktreePath) =>
      isPathInside(this.#ownership.root, worktreePath),
    );
    if (remainingOwnedWorktrees.length > 0) {
      throw new Error("BranchMesh worktrees remain registered after cleanup");
    }

    await this.#ownership.removeRoot();
    this.#cleaned = true;
  }

  public async listRepositoryWorktrees(): Promise<string[]> {
    const result = assertGitSuccess(
      await this.#runGitAdministration(
        ["--git-dir", this.#repository.commonGitDirectory, "worktree", "list", "--porcelain", "-z"],
        { cwd: this.#ownership.root },
      ),
      "Git worktree enumeration",
    );

    return parseWorktreePorcelainZ(result.stdout).map((worktree) => path.resolve(worktree.path));
  }

  async #runGitAdministration(
    args: readonly string[],
    options: GitCommandOptions,
  ): Promise<GitCommandResult> {
    const run = this.#gitAdministrationTail.then(async () => await this.#git.run(args, options));
    this.#gitAdministrationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
