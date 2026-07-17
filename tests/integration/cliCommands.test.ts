import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runDoctor } from "../../src/commands/doctor.js";
import { parseScanConfig } from "../../src/config/schema.js";
import { createDemoRepository } from "../../src/demo/createDemoRepository.js";
import { assertGitSuccess, GitClient } from "../../src/git/GitClient.js";
import { createProgram } from "../../src/index.js";
import { RunResultSchema } from "../../src/model/results.js";

const demoConfig = parseScanConfig({
  base: "main",
  branches: ["feature/status-output", "feature/jitter", "feature/config-seconds"],
  commands: [
    { id: "test", label: "Tests", kind: "test", command: "node --test", timeoutMs: 30_000 },
  ],
  execution: { concurrency: 1 },
});

describe("Milestone 5 command integration", () => {
  it("doctor checks the captured repository without creating worktrees or reports", async () => {
    const demo = await createDemoRepository();
    const outputDirectory = path.join(demo.root, "doctor-output");
    try {
      const before = await captureRepositoryState(demo.root, demo.repositoryPath);
      const outcome = await runDoctor({
        repositoryPath: demo.repositoryPath,
        config: demoConfig,
        outputDirectory,
      });
      const after = await captureRepositoryState(demo.root, demo.repositoryPath);

      expect(outcome.checks.every((check) => check.status === "pass")).toBe(true);
      expect(outcome.snapshot.branches.map((branch) => branch.ref)).toEqual([
        "feature/config-seconds",
        "feature/jitter",
        "feature/status-output",
      ]);
      expect(after).toBe(before);
      await expect(access(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await demo.cleanup();
    }
  });

  it("doctor reports ignored dirt honestly and rejects missing entry executables", async () => {
    const demo = await createDemoRepository();
    await writeFile(path.join(demo.repositoryPath, "dirty-untracked.txt"), "dirty\n", "utf8");
    try {
      const dirtyOutcome = await runDoctor({
        repositoryPath: demo.repositoryPath,
        config: parseScanConfig({
          ...demoConfig,
          execution: { ...demoConfig.execution, ignoreDirty: true },
        }),
        outputDirectory: path.join(demo.root, "doctor-output"),
      });
      expect(dirtyOutcome.checks.find((check) => check.id === "worktrees")).toMatchObject({
        status: "warning",
      });

      await expect(
        runDoctor({
          repositoryPath: demo.repositoryPath,
          config: parseScanConfig({
            ...demoConfig,
            commands: [
              {
                id: "custom",
                label: "Missing",
                kind: "custom",
                command: "branchmesh-definitely-missing-executable",
              },
            ],
            execution: { ...demoConfig.execution, ignoreDirty: true },
          }),
          outputDirectory: path.join(demo.root, "doctor-output"),
          environment: { PATH: "" },
        }),
      ).rejects.toMatchObject({ exitCode: 2 });
    } finally {
      await demo.cleanup();
    }
  });

  it("scan CLI uses the production engine and preserves conflict exit code 1", async () => {
    const demo = await createDemoRepository();
    const configPath = path.join(demo.repositoryPath, "branchmesh.config.json");
    const outputDirectory = path.join(demo.root, "cli-output");
    await writeFile(configPath, `${JSON.stringify(demoConfig, null, 2)}\n`, "utf8");
    await runGit(demo.root, demo.repositoryPath, ["add", "--", "branchmesh.config.json"]);
    await runGit(demo.root, demo.repositoryPath, [
      "commit",
      "--message",
      "Add BranchMesh configuration",
    ]);

    try {
      const before = await captureRepositoryState(demo.root, demo.repositoryPath);
      let exitCode: number | undefined;
      let stdout = "";
      let stderr = "";
      await createProgram({
        cwd: demo.repositoryPath,
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
        setExitCode: (value) => (exitCode = value),
      }).parseAsync(["node", "branchmesh", "scan", "--output", outputDirectory]);

      const result = RunResultSchema.parse(
        JSON.parse(await readFile(path.join(outputDirectory, "result.json"), "utf8")),
      );
      expect(exitCode).toBe(1);
      expect(result.exitCode).toBe(1);
      expect(result.summary.behavioralConflicts).toBe(1);
      expect(result.jobs.find((job) => job.classification === "BEHAVIORAL_CONFLICT")).toMatchObject(
        { technicalClassification: "PAIR_TEST_FAILURE" },
      );
      expect(stdout).toMatch(/Compatibility matrix/u);
      expect(stdout).toMatch(/JSON:/u);
      expect(stdout).toMatch(/HTML:/u);
      expect(stderr).toMatch(/Base|base/u);
      expect(await captureRepositoryState(demo.root, demo.repositoryPath)).toBe(before);
      expect((await listWorktrees(demo.root, demo.repositoryPath)).length).toBe(1);
    } finally {
      await demo.cleanup();
    }
  });
});

async function runGit(root: string, repositoryPath: string, args: readonly string[]) {
  return assertGitSuccess(
    await new GitClient().run(
      ["-c", `core.hooksPath=${path.join(root, "hooks")}`, "-C", repositoryPath, ...args],
      { cwd: root },
    ),
    `CLI fixture Git command (${args[0] ?? "unknown"})`,
  );
}

async function captureRepositoryState(root: string, repositoryPath: string): Promise<string> {
  const outputs: string[] = [];
  for (const args of [
    ["rev-parse", "HEAD"],
    ["write-tree"],
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"],
    ["worktree", "list", "--porcelain", "-z"],
  ] as const) {
    outputs.push((await runGit(root, repositoryPath, args)).stdout);
  }
  return outputs.join("\0");
}

async function listWorktrees(root: string, repositoryPath: string): Promise<string[]> {
  return (await runGit(root, repositoryPath, ["worktree", "list", "--porcelain", "-z"])).stdout
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
}
