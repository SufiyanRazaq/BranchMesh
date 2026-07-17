import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { VerticalSliceConfig } from "../../src/config/schema.js";
import { createDemoRepository } from "../../src/demo/createDemoRepository.js";
import { runDemo } from "../../src/demo/runDemo.js";
import { runVerticalSlice } from "../../src/engine/runVerticalSlice.js";
import { assertGitSuccess, GitClient } from "../../src/git/GitClient.js";
import { RunResultSchema } from "../../src/model/results.js";

const passingDemoConfig: VerticalSliceConfig = {
  base: "main",
  branches: ["feature/config-seconds", "feature/jitter"],
  commands: [
    {
      id: "test",
      label: "Tests",
      kind: "test",
      command: "node --test",
    },
  ],
};

describe("serial vertical slice", () => {
  it("detects the demo behavioral conflict and removes every temporary worktree", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const outcome = await runDemo({ toolVersion: "test", outputDirectory: outputRoot });
      const persisted = RunResultSchema.parse(
        JSON.parse(await readFile(outcome.scan.resultPath, "utf8")),
      );
      const pair = persisted.jobs.find((job) => job.kind === "pair");

      expect(persisted.exitCode).toBe(1);
      expect(persisted.jobs.map((job) => job.classification)).toEqual([
        "BASE_PASS",
        "BRANCH_PASS",
        "BRANCH_PASS",
        "BEHAVIORAL_CONFLICT",
      ]);
      expect(pair?.technicalClassification).toBe("PAIR_TEST_FAILURE");
      expect(pair?.conflictedFiles).toEqual([]);
      expect(outcome.repositoryUnchanged).toBe(true);
      expect(outcome.temporaryWorktreesRemaining).toBe(0);
      expect(await pathExists(outcome.scan.executionRoot)).toBe(false);
      expect(await pathExists(outcome.demoRoot)).toBe(false);
    } finally {
      await rm(outputRoot, { recursive: true });
    }
  });

  it("stops after an invalid base and still cleans its worktree", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const outcome = await runVerticalSlice({
        repositoryPath: demo.repositoryPath,
        config: {
          ...passingDemoConfig,
          commands: [
            {
              id: "test",
              label: "Tests",
              kind: "test",
              command: `node -e "process.exit(1)"`,
            },
          ],
        },
        toolVersion: "test",
        outputDirectory: outputRoot,
      });

      expect(outcome.result.exitCode).toBe(3);
      expect(outcome.result.jobs.map((job) => job.classification)).toEqual(["INVALID_BASELINE"]);
      expect(await pathExists(outcome.executionRoot)).toBe(false);
      expect(await listWorktrees(demo.repositoryPath)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });

  it("terminates a cancelled validation process before cleaning its worktree", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    const runRootsBefore = await listExecutionRoots();
    const cancellation = new AbortController();
    const abortTimer = setTimeout(() => cancellation.abort(), 150);

    try {
      await expect(
        runVerticalSlice({
          repositoryPath: demo.repositoryPath,
          config: {
            ...passingDemoConfig,
            commands: [
              {
                id: "wait",
                label: "Wait",
                kind: "custom",
                command: `node -e "setTimeout(() => {}, 10000)"`,
              },
            ],
          },
          toolVersion: "test",
          outputDirectory: outputRoot,
          signal: cancellation.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });

      expect(await listWorktrees(demo.repositoryPath)).toEqual([path.resolve(demo.repositoryPath)]);
      expect(await listExecutionRoots()).toEqual(runRootsBefore);
    } finally {
      clearTimeout(abortTimer);
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });
});

async function listWorktrees(repositoryPath: string): Promise<string[]> {
  const result = assertGitSuccess(
    await new GitClient().run(["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"], {
      cwd: os.tmpdir(),
    }),
    "Test worktree enumeration",
  );
  return result.stdout
    .split("\u0000")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => path.resolve(field.slice("worktree ".length)));
}

async function listExecutionRoots(): Promise<string[]> {
  return (await readdir(os.tmpdir())).filter((entry) => entry.startsWith("branchmesh-run-")).sort();
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
