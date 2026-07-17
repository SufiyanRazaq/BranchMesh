import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WorktreeManager } from "../../src/engine/WorktreeManager.js";
import type { ExecutionOwnership } from "../../src/engine/ownership.js";
import type { GitClient, GitCommandResult } from "../../src/git/GitClient.js";

describe("WorktreeManager Git administration", () => {
  it("serializes concurrent Git worktree mutations within one scan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "branchmesh-worktree-manager-test-"));
    const hooksDirectory = path.join(root, "hooks");
    const worktreesDirectory = path.join(root, "worktrees");
    await mkdir(hooksDirectory);
    await mkdir(worktreesDirectory);

    let activeWorktreeCommands = 0;
    let maximumConcurrentWorktreeCommands = 0;
    const registeredPathBasenames: string[] = [];
    const git: GitClient = {
      run: async (args: readonly string[], options: { readonly cwd: string }) => {
        const detachIndex = args.indexOf("--detach");
        const registeredPath = detachIndex === -1 ? undefined : args[detachIndex + 1];
        if (registeredPath !== undefined) {
          registeredPathBasenames.push(path.basename(registeredPath));
        }
        activeWorktreeCommands += 1;
        maximumConcurrentWorktreeCommands = Math.max(
          maximumConcurrentWorktreeCommands,
          activeWorktreeCommands,
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 25);
        });
        activeWorktreeCommands -= 1;
        return successfulGitResult(args, options.cwd);
      },
    };
    const ownership = {
      root,
      hooksDirectory,
      worktreesDirectory,
      registerWorktree: () => Promise.resolve(),
      updateWorktree: () => Promise.resolve(),
    } as unknown as ExecutionOwnership;
    const manager = new WorktreeManager(
      git,
      { root, commonGitDirectory: path.join(root, "repository.git") },
      ownership,
    );

    try {
      await Promise.all([
        manager.create("branch-0", "a".repeat(40)),
        manager.create("branch-1", "b".repeat(40)),
      ]);

      expect(maximumConcurrentWorktreeCommands).toBe(1);
      expect(new Set(registeredPathBasenames).size).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function successfulGitResult(args: readonly string[], cwd: string): GitCommandResult {
  return {
    args: [...args],
    cwd,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    durationMs: 0,
  };
}
