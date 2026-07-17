import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseScanConfig } from "../../src/config/schema.js";
import { createDemoRepository } from "../../src/demo/createDemoRepository.js";
import { runScan } from "../../src/engine/runScan.js";
import { assertGitSuccess, GitClient } from "../../src/git/GitClient.js";
import { RepositoryInspector } from "../../src/git/RepositoryInspector.js";
import { parseWorktreePorcelainZ } from "../../src/git/WorktreeParser.js";

const explicitConfig = parseScanConfig({
  base: "main",
  branches: ["feature/status-output", "feature/jitter", "feature/config-seconds"],
  commands: [{ id: "pass", label: "Pass", kind: "custom", command: 'node -e "process.exit(0)"' }],
  execution: { concurrency: 1 },
});

describe("repository preflight", () => {
  it("discovers and deterministically selects clean active worktrees", async () => {
    const demo = await createDemoRepository();
    const linkedRoot = path.join(demo.root, "selected-worktrees");
    await mkdir(linkedRoot);
    const linkedPaths = [
      path.join(linkedRoot, "c"),
      path.join(linkedRoot, "a"),
      path.join(linkedRoot, "b"),
    ];
    const branches = [demo.branchCRef, demo.branchARef, demo.branchBRef];

    try {
      for (const [index, branch] of branches.entries()) {
        const linkedPath = linkedPaths[index];
        if (linkedPath !== undefined) {
          await runGit(demo, ["worktree", "add", linkedPath, branch]);
        }
      }

      const snapshot = await new RepositoryInspector(new GitClient()).preflight(
        demo.repositoryPath,
        parseScanConfig({
          ...explicitConfig,
          branches: {
            source: "worktrees",
            include: ["*"],
            exclude: ["feature/does-not-match-*"],
          },
        }),
      );

      expect(snapshot.repository.root).toBe(await realpath(demo.repositoryPath));
      expect(snapshot.repository.commonGitDirectory).toBe(
        await realpath(path.join(demo.repositoryPath, ".git")),
      );
      expect(snapshot.branches.map((branch) => branch.ref)).toEqual([
        demo.branchARef,
        demo.branchBRef,
        demo.branchCRef,
      ]);
      expect(snapshot.branches.every((branch) => branch.dirty === false)).toBe(true);
      expect(snapshot.branches.map((branch) => branch.worktreePath)).toEqual(
        [...linkedPaths].sort(compareText),
      );
    } finally {
      for (const linkedPath of [...linkedPaths].reverse()) {
        await removeFixtureWorktree(demo, linkedPath);
      }
      await demo.cleanup();
    }
  });

  it("rejects a dirty selected worktree without modifying or unregistering it", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    const dirtyWorktree = path.join(demo.root, "dirty-selected-worktree");
    const executionRootsBefore = await listExecutionRoots();

    try {
      await runGit(demo, ["worktree", "add", dirtyWorktree, demo.branchCRef]);
      await writeFile(path.join(dirtyWorktree, "untracked.txt"), "dirty\n", "utf8");

      await expect(
        runScan({
          repositoryPath: demo.repositoryPath,
          config: explicitConfig,
          toolVersion: "test",
          outputDirectory: outputRoot,
        }),
      ).rejects.toMatchObject({ exitCode: 4 });

      expect(await listWorktrees(demo)).toContain(path.resolve(dirtyWorktree));
      expect(await listExecutionRoots()).toEqual(executionRootsBefore);
    } finally {
      await removeFixtureWorktree(demo, dirtyWorktree);
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });

  it("rejects persistent output inside any existing repository worktree", async () => {
    const demo = await createDemoRepository();
    const linkedWorktree = path.join(demo.root, "clean-selected-worktree");
    const executionRootsBefore = await listExecutionRoots();

    try {
      await runGit(demo, ["worktree", "add", linkedWorktree, demo.branchCRef]);
      await expect(
        runScan({
          repositoryPath: demo.repositoryPath,
          config: explicitConfig,
          toolVersion: "test",
          outputDirectory: path.join(linkedWorktree, "reports"),
        }),
      ).rejects.toThrow(/outside the scanned repository/u);

      expect(await listWorktrees(demo)).toContain(path.resolve(linkedWorktree));
      expect(await listExecutionRoots()).toEqual(executionRootsBefore);
    } finally {
      await removeFixtureWorktree(demo, linkedWorktree);
      await demo.cleanup();
    }
  });

  it("rejects repositories whose selected commits use Git LFS", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      await writeFile(
        path.join(demo.repositoryPath, ".gitattributes"),
        "*.bin filter=lfs diff=lfs\n",
      );
      await runGit(demo, ["add", "--", ".gitattributes"]);
      await runGit(demo, ["commit", "--message", "Add LFS attributes"]);

      await expect(
        runScan({
          repositoryPath: demo.repositoryPath,
          config: {
            ...explicitConfig,
            execution: { ...explicitConfig.execution, ignoreDirty: true },
          },
          toolVersion: "test",
          outputDirectory: outputRoot,
        }),
      ).rejects.toThrow(/Git LFS/u);
      expect(await listWorktrees(demo)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });

  it("rejects repositories whose selected commits contain a submodule entry", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const head = (await runGit(demo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(demo, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${head},vendor/dependency`,
      ]);
      await runGit(demo, ["commit", "--message", "Add submodule tree entry"]);

      await expect(
        runScan({
          repositoryPath: demo.repositoryPath,
          config: {
            ...explicitConfig,
            execution: { ...explicitConfig.execution, ignoreDirty: true },
          },
          toolVersion: "test",
          outputDirectory: outputRoot,
        }),
      ).rejects.toThrow(/submodules/u);
      expect(await listWorktrees(demo)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });

  it("rejects native Windows before accessing repository state", async () => {
    const inspector = new RepositoryInspector(new GitClient(), { platform: "win32" });
    await expect(
      inspector.preflight("/path/that/need/not/exist", explicitConfig),
    ).rejects.toMatchObject({ exitCode: 4 });
  });
});

async function runGit(demo: { root: string; repositoryPath: string }, args: readonly string[]) {
  return assertGitSuccess(
    await new GitClient().run(
      ["-c", `core.hooksPath=${path.join(demo.root, "hooks")}`, "-C", demo.repositoryPath, ...args],
      { cwd: demo.root },
    ),
    `Fixture Git command: ${args[0] ?? "unknown"}`,
  );
}

async function listWorktrees(demo: { root: string; repositoryPath: string }): Promise<string[]> {
  const result = await runGit(demo, ["worktree", "list", "--porcelain", "-z"]);
  return parseWorktreePorcelainZ(result.stdout).map((worktree) => path.resolve(worktree.path));
}

async function removeFixtureWorktree(
  demo: { root: string; repositoryPath: string },
  worktreePath: string,
): Promise<void> {
  if ((await listWorktrees(demo)).includes(path.resolve(worktreePath))) {
    await runGit(demo, ["worktree", "remove", "--force", worktreePath]);
  }
}

async function listExecutionRoots(): Promise<string[]> {
  return (await readdir(os.tmpdir())).filter((entry) => entry.startsWith("branchmesh-run-")).sort();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
