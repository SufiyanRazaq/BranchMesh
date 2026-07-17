import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MergeRunner } from "../../src/engine/MergeRunner.js";
import type { ExecutionOwnership } from "../../src/engine/ownership.js";
import type { GitClient, GitCommandOptions, GitCommandResult } from "../../src/git/GitClient.js";
import type { BranchSnapshot } from "../../src/model/results.js";

describe("synthetic merge command", () => {
  it("disables hooks, signing, rerere, automatic maintenance, and auto-GC per invocation", async () => {
    const root = path.join(os.tmpdir(), "branchmesh-merge-runner-unit");
    const worktreePath = path.join(root, "worktrees", "pair", "checkout");
    const hooksDirectory = path.join(root, "hooks");
    const calls: Array<{ args: readonly string[]; options: GitCommandOptions }> = [];
    const git: GitClient = {
      run: (args: readonly string[], options: GitCommandOptions): Promise<GitCommandResult> => {
        calls.push({ args, options });
        return Promise.resolve({
          args,
          cwd: options.cwd,
          stdout: "",
          stderr: "",
          exitCode: 0,
          signal: null,
          durationMs: 1,
        });
      },
    };
    const ownership = {
      root,
      hooksDirectory,
      verify: () => Promise.resolve(),
      assertOwnedPath: () => Promise.resolve(),
    } as unknown as ExecutionOwnership;
    const snapshot: BranchSnapshot = {
      ref: "feature/a",
      fullRef: "refs/heads/feature/a",
      sha: "a".repeat(40),
      changedFiles: ["a.txt"],
      dirty: false,
      worktreePath: null,
    };

    await new MergeRunner(git, ownership).merge(worktreePath, [snapshot]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      args: [
        "-C",
        worktreePath,
        "-c",
        `core.hooksPath=${hooksDirectory}`,
        "-c",
        "commit.gpgSign=false",
        "-c",
        "rerere.enabled=false",
        "-c",
        "rerere.autoupdate=false",
        "-c",
        "maintenance.auto=false",
        "-c",
        "gc.auto=0",
        "merge",
        "--no-ff",
        "--no-edit",
        "--no-gpg-sign",
        "--no-rerere-autoupdate",
        snapshot.sha,
      ],
      options: {
        cwd: root,
        env: {
          GIT_AUTHOR_NAME: "BranchMesh",
          GIT_AUTHOR_EMAIL: "branchmesh@local",
          GIT_COMMITTER_NAME: "BranchMesh",
          GIT_COMMITTER_EMAIL: "branchmesh@local",
        },
      },
    });
  });
});
