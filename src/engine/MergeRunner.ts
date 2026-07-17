import path from "node:path";

import { GitCommandError } from "../git/GitClient.js";
import type { GitClient } from "../git/GitClient.js";
import type { BranchSnapshot } from "../model/results.js";
import type { ExecutionOwnership } from "./ownership.js";

export interface MergeOutcome {
  readonly merged: boolean;
  readonly conflictedFiles: readonly string[];
}

const syntheticIdentity: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "BranchMesh",
  GIT_AUTHOR_EMAIL: "branchmesh@local",
  GIT_COMMITTER_NAME: "BranchMesh",
  GIT_COMMITTER_EMAIL: "branchmesh@local",
};

export class MergeRunner {
  readonly #git: GitClient;
  readonly #ownership: ExecutionOwnership;
  readonly #signal: AbortSignal | undefined;

  public constructor(git: GitClient, ownership: ExecutionOwnership, signal?: AbortSignal) {
    this.#git = git;
    this.#ownership = ownership;
    this.#signal = signal;
  }

  public async merge(
    worktreePath: string,
    snapshots: readonly BranchSnapshot[],
  ): Promise<MergeOutcome> {
    await this.#ownership.verify();
    await this.#ownership.assertOwnedPath(worktreePath);

    for (const snapshot of snapshots) {
      const result = await this.#git.run(
        [
          "-C",
          worktreePath,
          "-c",
          `core.hooksPath=${this.#ownership.hooksDirectory}`,
          "-c",
          "commit.gpgSign=false",
          "merge",
          "--no-ff",
          "--no-edit",
          "--no-gpg-sign",
          snapshot.sha,
        ],
        {
          cwd: this.#ownership.root,
          signal: this.#signal,
          env: syntheticIdentity,
        },
      );

      if (result.exitCode === 0) {
        continue;
      }

      const conflictedFiles = await this.#conflictedFiles(worktreePath);
      if (conflictedFiles.length === 0) {
        throw new GitCommandError(
          `Synthetic merge for ${snapshot.ref} failed without unresolved files`,
          result,
        );
      }

      return { merged: false, conflictedFiles };
    }

    return { merged: true, conflictedFiles: [] };
  }

  async #conflictedFiles(worktreePath: string): Promise<string[]> {
    const result = await this.#git.run(
      ["-C", worktreePath, "diff", "--name-only", "--diff-filter=U", "-z"],
      { cwd: this.#ownership.root, signal: this.#signal },
    );
    if (result.exitCode !== 0) {
      throw new GitCommandError("Unable to collect conflicted files", result);
    }

    return result.stdout
      .split("\0")
      .filter((filePath) => filePath.length > 0)
      .map((filePath) => filePath.split(path.sep).join("/"))
      .sort((left, right) => left.localeCompare(right, "en"));
  }
}
