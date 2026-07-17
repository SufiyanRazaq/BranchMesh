import { execFile, spawn } from "node:child_process";
import { rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

import { scanConfig } from "../helpers/scanTestSupport.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";

const runnerPath = path.resolve(".agents/skills/branchmesh/scripts/run-branchmesh.mjs");
const execFileAsync = promisify(execFile);

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build", "--silent"], { cwd: path.resolve(".") });
}, 30_000);

describe("repository skill workflow", () => {
  it("runs doctor before a real deterministic scan and validates its exact bundle", async () => {
    const repository = await createSkillRepository();
    const outputDirectory = path.join(repository.root, "skill report");
    try {
      const before = await repository.captureState();
      const outcome = await runWrapper([
        "scan",
        "--repository",
        repository.repositoryPath,
        "--base",
        "main",
        "--branch",
        "feature/a",
        "--branch",
        "feature/b",
        "--output",
        outputDirectory,
      ]);
      const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;

      expect(outcome.exitCode).toBe(0);
      expect(outcome.stderr.indexOf("running doctor before scan")).toBeGreaterThanOrEqual(0);
      expect(outcome.stderr.indexOf("doctor passed; running deterministic scan")).toBeGreaterThan(
        outcome.stderr.indexOf("running doctor before scan"),
      );
      expect(envelope).toMatchObject({
        validated: true,
        scanExitCode: 0,
        reportRetained: true,
        resultPath: path.join(outputDirectory, "result.json"),
        pairs: [{ classification: "NO_DETECTED_CONFLICT" }],
      });
      expect(await repository.captureState()).toEqual(before);
      expect(await repository.listWorktrees()).toEqual([repository.repositoryPath]);

      await rm(path.join(outputDirectory, "report.html"));
      await symlink(
        path.join(repository.root, "outside.html"),
        path.join(outputDirectory, "report.html"),
      );
      const rejected = await runWrapper(["validate", path.join(outputDirectory, "result.json")]);
      expect(rejected.exitCode).toBe(2);
      expect(rejected.stderr).toMatch(/symlinked evidence/iu);
    } finally {
      await repository.cleanup();
    }
  }, 30_000);

  it("forces doctor to reject dirt even when configuration opts into ignoring it", async () => {
    const repository = await createSkillRepository(true);
    try {
      await repository.writeFiles({ "uncommitted.txt": "must remain\n" });
      const before = await repository.captureState();
      const outcome = await runWrapper([
        "scan",
        "--repository",
        repository.repositoryPath,
        "--branch",
        "feature/a",
        "--branch",
        "feature/b",
        "--output",
        path.join(repository.root, "blocked-report"),
      ]);

      expect(outcome.exitCode).toBe(4);
      expect(outcome.stderr).toContain("running doctor before scan");
      expect(outcome.stderr).not.toContain("doctor passed; running deterministic scan");
      expect(await repository.captureState()).toEqual(before);
      expect(await repository.listWorktrees()).toEqual([repository.repositoryPath]);
    } finally {
      await repository.cleanup();
    }
  }, 30_000);

  it("validates and envelopes a result-bearing invalid base", async () => {
    const repository = await createSkillRepository(false, 'node -e "process.exit(1)"');
    const outputDirectory = path.join(repository.root, "invalid-base-report");
    try {
      const outcome = await runWrapper([
        "scan",
        "--repository",
        repository.repositoryPath,
        "--branch",
        "feature/a",
        "--branch",
        "feature/b",
        "--output",
        outputDirectory,
      ]);
      expect(outcome.exitCode).toBe(0);
      expect(JSON.parse(outcome.stdout)).toMatchObject({
        validated: true,
        scanExitCode: 3,
        base: { classification: "INVALID_BASELINE" },
        resultPath: path.join(outputDirectory, "result.json"),
      });
      expect(await repository.listWorktrees()).toEqual([repository.repositoryPath]);
    } finally {
      await repository.cleanup();
    }
  }, 30_000);

  it("returns interruption 130 and leaves no temporary worktree", async () => {
    const repository = await createSkillRepository(
      false,
      'node -e "setInterval(() => {}, 1000)"',
      30_000,
    );
    try {
      const before = await repository.captureState();
      const outcome = await runWrapper(
        [
          "scan",
          "--repository",
          repository.repositoryPath,
          "--branch",
          "feature/a",
          "--branch",
          "feature/b",
          "--output",
          path.join(repository.root, "cancelled-report"),
        ],
        (stderr, child) => {
          if (stderr.includes("Base validation")) child.kill("SIGINT");
        },
      );

      expect(outcome.exitCode).toBe(130);
      expect(await repository.captureState()).toEqual(before);
      expect(await repository.listWorktrees()).toEqual([repository.repositoryPath]);
    } finally {
      await repository.cleanup();
    }
  }, 30_000);
});

async function createSkillRepository(
  ignoreDirty = false,
  command = 'node -e "process.exit(0)"',
  timeoutMs = 5_000,
): Promise<TemporaryGitRepository> {
  const repository = await TemporaryGitRepository.create();
  await repository.createBranch("feature/a", { "a.txt": "a\n" });
  await repository.createBranch("feature/b", { "b.txt": "b\n" });
  const config = scanConfig(
    ["feature/a", "feature/b"],
    [{ id: "custom", label: "Custom", kind: "custom", command, timeoutMs }],
  );
  await repository.writeFiles({
    "branchmesh.config.json": `${JSON.stringify({
      ...config,
      execution: { ...config.execution, ignoreDirty },
    })}\n`,
  });
  await repository.commit("Add BranchMesh configuration");
  return repository;
}

interface WrapperOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runWrapper(
  arguments_: readonly string[],
  onStderr?: (stderr: string, child: ReturnType<typeof spawn>) => void,
): Promise<WrapperOutcome> {
  const child = spawn(process.execPath, [runnerPath, ...arguments_], {
    cwd: path.resolve("."),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let interruptionSent = false;
  const fallback = setTimeout(() => {
    if (!interruptionSent && onStderr !== undefined) {
      interruptionSent = true;
      child.kill("SIGINT");
    }
  }, 10_000);

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    if (!interruptionSent && onStderr !== undefined) {
      const source = Buffer.concat(stderr).toString("utf8");
      if (source.includes("Base validation")) interruptionSent = true;
      onStderr(source, child);
    }
  });

  try {
    return await new Promise<WrapperOutcome>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode: exitCode ?? (signal === null ? 2 : 130),
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  } finally {
    clearTimeout(fallback);
  }
}
