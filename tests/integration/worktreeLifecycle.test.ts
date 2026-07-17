import { access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseScanConfig } from "../../src/config/schema.js";
import { createDemoRepository } from "../../src/demo/createDemoRepository.js";
import { WorktreeManager } from "../../src/engine/WorktreeManager.js";
import { ExecutionOwnership } from "../../src/engine/ownership.js";
import { assertGitSuccess, GitClient } from "../../src/git/GitClient.js";
import { RepositoryInspector } from "../../src/git/RepositoryInspector.js";
import { parseWorktreePorcelainZ } from "../../src/git/WorktreeParser.js";

describe("worktree cleanup idempotence", () => {
  it("finishes cleanup when an earlier removal deleted the checkout before manifest update", async () => {
    const demo = await createDemoRepository();
    const git = new GitClient();
    let executionRoot: string | undefined;

    try {
      const snapshot = await new RepositoryInspector(git).preflight(
        demo.repositoryPath,
        parseScanConfig({
          base: demo.baseRef,
          branches: [demo.branchARef, demo.branchBRef, demo.branchCRef],
          commands: [
            { id: "pass", label: "Pass", kind: "custom", command: 'node -e "process.exit(0)"' },
          ],
        }),
      );
      const ownership = await ExecutionOwnership.create({
        runId: "idempotent-cleanup-test",
        repository: snapshot.repository,
        base: snapshot.base,
        branches: snapshot.branches,
      });
      const manager = new WorktreeManager(git, snapshot.repository, ownership);
      executionRoot = manager.executionRoot;
      const worktree = await manager.create("branch-0", snapshot.base.sha);

      assertGitSuccess(
        await git.run(
          [
            "--git-dir",
            snapshot.repository.commonGitDirectory,
            "worktree",
            "remove",
            "--force",
            worktree,
          ],
          { cwd: ownership.root },
        ),
        "Simulated prior worktree removal",
      );
      await rm(path.dirname(worktree), { recursive: true });

      await manager.cleanup("branch-0");
      await manager.cleanupAll();

      expect(await pathExists(executionRoot)).toBe(false);
      expect(await listWorktrees(git, demo.repositoryPath)).toEqual([
        path.resolve(demo.repositoryPath),
      ]);
    } finally {
      const executionRootRemains = executionRoot !== undefined && (await pathExists(executionRoot));
      await demo.cleanup();
      expect(executionRootRemains).toBe(false);
    }
  });
});

async function listWorktrees(git: GitClient, repositoryPath: string): Promise<string[]> {
  const result = assertGitSuccess(
    await git.run(["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"], {
      cwd: os.tmpdir(),
    }),
    "Test worktree enumeration",
  );
  return parseWorktreePorcelainZ(result.stdout).map((worktree) => path.resolve(worktree.path));
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
