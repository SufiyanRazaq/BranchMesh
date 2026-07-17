import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDemoRepository } from "../../src/demo/createDemoRepository.js";
import { runDemo } from "../../src/demo/runDemo.js";
import { runScan } from "../../src/engine/runScan.js";
import { assertGitSuccess, GitClient } from "../../src/git/GitClient.js";
import { parseWorktreePorcelainZ } from "../../src/git/WorktreeParser.js";
import { RunResultSchema } from "../../src/model/results.js";

const demoBranches = ["feature/config-seconds", "feature/jitter", "feature/status-output"];

describe("deterministic scan engine", () => {
  it("plans three individual jobs and all three pairs, detecting the demo behavioral conflict", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const outcome = await runDemo({ toolVersion: "test", outputDirectory: outputRoot });
      const persisted = RunResultSchema.parse(
        JSON.parse(await readFile(outcome.scan.resultPath, "utf8")),
      );
      const branches = persisted.jobs.filter((job) => job.kind === "branch");
      const pairs = persisted.jobs.filter((job) => job.kind === "pair");

      expect(persisted.exitCode).toBe(1);
      expect(persisted.branches.map((branch) => branch.ref)).toEqual(demoBranches);
      expect(branches).toHaveLength(3);
      expect(branches.map((job) => job.classification)).toEqual([
        "BRANCH_PASS",
        "BRANCH_PASS",
        "BRANCH_PASS",
      ]);
      expect(pairs.map((job) => [job.branchRefs, job.classification])).toEqual([
        [["feature/config-seconds", "feature/jitter"], "BEHAVIORAL_CONFLICT"],
        [["feature/config-seconds", "feature/status-output"], "NO_DETECTED_CONFLICT"],
        [["feature/jitter", "feature/status-output"], "NO_DETECTED_CONFLICT"],
      ]);
      expect(pairs[0]?.technicalClassification).toBe("PAIR_TEST_FAILURE");
      expect(pairs[0]?.conflictedFiles).toEqual([]);
      expect(persisted.summary).toMatchObject({ branchCount: 3, pairCount: 3 });
      expect(
        persisted.jobs.every(
          (job) =>
            /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(job.baseSha) &&
            job.branchShas.every((sha) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sha)),
        ),
      ).toBe(true);
      expect(persisted.branches.map((branch) => branch.changedFiles)).toEqual([
        ["src/config.js", "src/retry.js"],
        ["src/jitter.js", "test/jitter.test.js"],
        ["src/status.js", "test/status.test.js"],
      ]);
      expect(outcome.repositoryUnchanged).toBe(true);
      expect(outcome.temporaryWorktreesRemaining).toBe(0);
      expect(await pathExists(outcome.scan.executionRoot)).toBe(false);
      expect(await pathExists(outcome.demoRoot)).toBe(false);
    } finally {
      await rm(outputRoot, { recursive: true });
    }
  });

  it("emits PAIR_SKIPPED for every pair containing an individually failing branch", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const outcome = await runScan({
        repositoryPath: demo.repositoryPath,
        config: scanConfig([
          {
            id: "status-guard",
            label: "Status guard",
            kind: "custom",
            command:
              "node -e \"const fs=require('node:fs'); process.exit(fs.existsSync('src/status.js') ? 1 : 0)\"",
            timeoutMs: 5_000,
          },
        ]),
        toolVersion: "test",
        outputDirectory: outputRoot,
      });
      const branches = outcome.result.jobs.filter((job) => job.kind === "branch");
      const pairs = outcome.result.jobs.filter((job) => job.kind === "pair");

      expect(branches.map((job) => job.classification)).toEqual([
        "BRANCH_PASS",
        "BRANCH_PASS",
        "BRANCH_CUSTOM_FAILURE",
      ]);
      expect(pairs.map((job) => job.classification)).toEqual([
        "NO_DETECTED_CONFLICT",
        "PAIR_SKIPPED",
        "PAIR_SKIPPED",
      ]);
      expect(pairs.slice(1).every((job) => job.skipReason === "INDIVIDUAL_BRANCH_FAILED")).toBe(
        true,
      );
      expect(await listWorktrees(demo.repositoryPath)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });

  it("stores canonical result order when concurrent jobs finish out of order", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const outcome = await runScan({
        repositoryPath: demo.repositoryPath,
        config: {
          ...scanConfig([
            {
              id: "variable-delay",
              label: "Variable delay",
              kind: "custom",
              command:
                "node -e \"const fs=require('node:fs'); const delay=fs.existsSync('src/status.js') ? 10 : fs.existsSync('src/jitter.js') ? 150 : fs.readFileSync('src/config.js','utf8').includes('retryDelaySeconds') ? 250 : 50; setTimeout(() => {}, delay)\"",
              timeoutMs: 5_000,
            },
          ]),
          execution: {
            maxBranches: 5,
            concurrency: 2,
            failFast: false,
            skipPairsWithFailedBranches: true,
            ignoreDirty: false,
            maximumLogBytes: 4096,
          },
        },
        toolVersion: "test",
        outputDirectory: outputRoot,
      });

      expect(outcome.result.runtime.concurrency).toBe(2);
      expect(outcome.result.jobs.map((job) => job.id)).toEqual([
        "base",
        "branch-0",
        "branch-1",
        "branch-2",
        "pair-0-1",
        "pair-0-2",
        "pair-1-2",
      ]);
      expect(outcome.result.exitCode).toBe(0);
      expect(await listWorktrees(demo.repositoryPath)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });

  it("runs setup before validation and stops a command pipeline after its first failure", async () => {
    const demo = await createDemoRepository();
    const setupOutput = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    const stopOutput = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const setupOutcome = await runScan({
        repositoryPath: demo.repositoryPath,
        config: {
          ...scanConfig([
            {
              id: "verify-setup",
              label: "Verify setup",
              kind: "custom",
              command:
                "node -e \"process.exit(require('node:fs').existsSync('.setup-ready') ? 0 : 1)\"",
              timeoutMs: 5_000,
            },
          ]),
          setup: {
            command: "node -e \"require('node:fs').writeFileSync('.setup-ready', 'yes')\"",
            timeoutMs: 5_000,
          },
        },
        toolVersion: "test",
        outputDirectory: setupOutput,
      });
      expect(setupOutcome.result.exitCode).toBe(0);
      expect(
        setupOutcome.result.jobs.every(
          (job) => job.commands.map((command) => command.id).join(",") === "setup,verify-setup",
        ),
      ).toBe(true);

      const stopOutcome = await runScan({
        repositoryPath: demo.repositoryPath,
        config: scanConfig([
          {
            id: "first",
            label: "First failure",
            kind: "custom",
            command: 'node -e "process.exit(1)"',
            timeoutMs: 5_000,
          },
          {
            id: "must-not-run",
            label: "Must not run",
            kind: "custom",
            command: 'node -e "process.exit(0)"',
            timeoutMs: 5_000,
          },
        ]),
        toolVersion: "test",
        outputDirectory: stopOutput,
      });
      expect(stopOutcome.result.exitCode).toBe(3);
      expect(stopOutcome.result.jobs).toHaveLength(1);
      expect(stopOutcome.result.jobs[0]?.commands.map((command) => command.id)).toEqual(["first"]);
      expect(await listWorktrees(demo.repositoryPath)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(setupOutput, { recursive: true });
      await rm(stopOutput, { recursive: true });
    }
  });

  it("stops after an invalid base and classifies a base timeout deterministically", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    try {
      const outcome = await runScan({
        repositoryPath: demo.repositoryPath,
        config: scanConfig([
          {
            id: "wait",
            label: "Wait",
            kind: "custom",
            command: 'node -e "setTimeout(() => {}, 10000)"',
            timeoutMs: 50,
          },
        ]),
        toolVersion: "test",
        outputDirectory: outputRoot,
      });

      expect(outcome.result.exitCode).toBe(3);
      expect(outcome.result.jobs.map((job) => job.classification)).toEqual(["BASE_TIMEOUT"]);
      expect(outcome.result.jobs[0]?.commands[0]?.status).toBe("timed_out");
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
    const abortTimer = setTimeout(() => cancellation.abort(), 750);

    try {
      await expect(
        runScan({
          repositoryPath: demo.repositoryPath,
          config: {
            ...scanConfig([
              {
                id: "wait-on-branches",
                label: "Wait on branches",
                kind: "custom",
                command:
                  "node -e \"const fs=require('node:fs'); const branch=fs.existsSync('src/jitter.js') || fs.existsSync('src/status.js') || fs.readFileSync('src/config.js','utf8').includes('retryDelaySeconds'); if (branch) setTimeout(() => {}, 10000)\"",
                timeoutMs: 20_000,
              },
            ]),
            execution: {
              maxBranches: 5,
              concurrency: 2,
              failFast: false,
              skipPairsWithFailedBranches: true,
              ignoreDirty: false,
              maximumLogBytes: 4096,
            },
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

  it("cleans all worktrees before an atomic result-publication failure is reported", async () => {
    const demo = await createDemoRepository();
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-test-output-"));
    await writeFile(path.join(outputRoot, "result.json"), "do not overwrite\n", "utf8");

    try {
      await expect(
        runScan({
          repositoryPath: demo.repositoryPath,
          config: scanConfig([
            {
              id: "pass",
              label: "Pass",
              kind: "custom",
              command: 'node -e "process.exit(0)"',
              timeoutMs: 5_000,
            },
          ]),
          toolVersion: "test",
          outputDirectory: outputRoot,
        }),
      ).rejects.toMatchObject({ code: "EEXIST" });

      expect(await readFile(path.join(outputRoot, "result.json"), "utf8")).toBe(
        "do not overwrite\n",
      );
      expect(await listWorktrees(demo.repositoryPath)).toEqual([path.resolve(demo.repositoryPath)]);
    } finally {
      await demo.cleanup();
      await rm(outputRoot, { recursive: true });
    }
  });
});

function scanConfig(commands: readonly Record<string, unknown>[]) {
  return {
    base: "main",
    branches: [...demoBranches].reverse(),
    commands,
    execution: {
      maxBranches: 5,
      concurrency: 1,
      failFast: false,
      skipPairsWithFailedBranches: true,
      ignoreDirty: false,
      maximumLogBytes: 4096,
    },
  };
}

async function listWorktrees(repositoryPath: string): Promise<string[]> {
  const result = assertGitSuccess(
    await new GitClient().run(["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"], {
      cwd: os.tmpdir(),
    }),
    "Test worktree enumeration",
  );
  return parseWorktreePorcelainZ(result.stdout).map((worktree) => path.resolve(worktree.path));
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
