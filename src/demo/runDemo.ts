import { access } from "node:fs/promises";
import path from "node:path";

import { parseScanConfig } from "../config/schema.js";
import { runScan, type ScanOutcome } from "../engine/runScan.js";
import { assertGitSuccess, GitClient } from "../git/GitClient.js";
import { parseWorktreePorcelainZ } from "../git/WorktreeParser.js";
import { createDemoRepository } from "./createDemoRepository.js";

export interface DemoOptions {
  readonly toolVersion: string;
  readonly outputDirectory?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface DemoOutcome {
  readonly scan: ScanOutcome;
  readonly demoRoot: string;
  readonly demoRepository: string;
  readonly repositoryUnchanged: true;
  readonly temporaryWorktreesRemaining: 0;
}

const demoConfig = parseScanConfig({
  base: "main",
  // Deliberately unsorted to prove that the engine canonicalizes branch and pair order.
  branches: ["feature/status-output", "feature/jitter", "feature/config-seconds"],
  commands: [
    {
      id: "test",
      label: "Tests",
      kind: "test",
      command: "node --test",
      timeoutMs: 30_000,
    },
  ],
});

export async function runDemo(options: DemoOptions): Promise<DemoOutcome> {
  const demo = await createDemoRepository();
  const git = new GitClient();

  try {
    const stateBefore = await captureRepositoryState(git, demo.root, demo.repositoryPath);
    const scan = await runScan({
      repositoryPath: demo.repositoryPath,
      config: demoConfig,
      toolVersion: options.toolVersion,
      ...(options.outputDirectory === undefined
        ? {}
        : { outputDirectory: options.outputDirectory }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const stateAfter = await captureRepositoryState(git, demo.root, demo.repositoryPath);

    if (stateAfter !== stateBefore) {
      throw new Error("The demo repository changed while BranchMesh scanned it");
    }
    if (await pathExists(scan.executionRoot)) {
      throw new Error("The BranchMesh execution root remains after scan cleanup");
    }

    const worktrees = await listWorktrees(git, demo.root, demo.repositoryPath);
    const temporaryWorktrees = worktrees.filter(
      (worktreePath) => path.resolve(worktreePath) !== path.resolve(demo.repositoryPath),
    );
    if (temporaryWorktrees.length !== 0) {
      throw new Error("Temporary demo worktrees remain registered after the scan");
    }

    return {
      scan,
      demoRoot: demo.root,
      demoRepository: demo.repositoryPath,
      repositoryUnchanged: true,
      temporaryWorktreesRemaining: 0,
    };
  } finally {
    await demo.cleanup();
  }
}

async function captureRepositoryState(
  git: GitClient,
  neutralCwd: string,
  repositoryPath: string,
): Promise<string> {
  const commands = [
    ["-C", repositoryPath, "symbolic-ref", "--quiet", "--short", "HEAD"],
    ["-C", repositoryPath, "rev-parse", "HEAD"],
    ["-C", repositoryPath, "write-tree"],
    ["-C", repositoryPath, "status", "--porcelain=v1", "--untracked-files=all"],
    ["-C", repositoryPath, "for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"],
    ["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"],
  ] as const;
  const output: string[] = [];
  for (const args of commands) {
    output.push(
      assertGitSuccess(await git.run(args, { cwd: neutralCwd }), "Demo repository state capture")
        .stdout,
    );
  }
  return output.join("\u0000");
}

async function listWorktrees(
  git: GitClient,
  neutralCwd: string,
  repositoryPath: string,
): Promise<string[]> {
  const result = assertGitSuccess(
    await git.run(["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"], {
      cwd: neutralCwd,
    }),
    "Demo worktree verification",
  );
  return parseWorktreePorcelainZ(result.stdout).map((worktree) => worktree.path);
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
