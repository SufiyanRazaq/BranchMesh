import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { VerticalSliceConfig } from "../config/schema.js";
import { BranchSnapshotSchema, type BranchSnapshot } from "../model/results.js";
import { assertGitSuccess } from "./GitClient.js";
import type { GitClient } from "./GitClient.js";

export interface RepositoryIdentity {
  readonly root: string;
  readonly commonGitDirectory: string;
}

export interface RepositorySnapshot {
  readonly repository: RepositoryIdentity;
  readonly base: BranchSnapshot;
  readonly branches: readonly [BranchSnapshot, BranchSnapshot];
}

export class RepositoryInspector {
  readonly #git: GitClient;
  readonly #neutralCwd: string;

  public constructor(git: GitClient, neutralCwd = os.tmpdir()) {
    this.#git = git;
    this.#neutralCwd = path.resolve(neutralCwd);
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

    return {
      root,
      commonGitDirectory: await realpath(commonDirectoryPath),
    };
  }

  public async snapshot(
    repositoryPath: string,
    config: VerticalSliceConfig,
    signal?: AbortSignal,
  ): Promise<RepositorySnapshot> {
    const repository = await this.resolveRepositoryRoot(repositoryPath, signal);
    const base = await this.#resolveSnapshot(repository, config.base, signal);
    const branchA = await this.#resolveSnapshot(repository, config.branches[0], signal);
    const branchB = await this.#resolveSnapshot(repository, config.branches[1], signal);

    return {
      repository,
      base,
      branches: [branchA, branchB],
    };
  }

  async #resolveSnapshot(
    repository: RepositoryIdentity,
    reference: string,
    signal?: AbortSignal,
  ): Promise<BranchSnapshot> {
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

    return BranchSnapshotSchema.parse({
      ref: reference,
      sha: result.stdout.trim().toLowerCase(),
    });
  }
}
