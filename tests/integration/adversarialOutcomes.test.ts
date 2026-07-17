import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ValidationCommand, ValidationCommandKind } from "../../src/config/schema.js";
import { runScan, type ScanOutcome } from "../../src/engine/runScan.js";
import { GitCommandError } from "../../src/git/GitClient.js";
import { RunResultSchema } from "../../src/model/results.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";
import {
  listExecutionRoots,
  passCommand,
  pathExists,
  scanConfig,
} from "../helpers/scanTestSupport.js";

const branches = ["feature/a", "feature/b"] as const;
const pairFailureCommandText =
  "node -e \"const fs=require('node:fs'); process.exit(fs.existsSync('a.flag') && fs.existsSync('b.flag') ? 1 : 0)\"";

describe("adversarial scan outcomes", () => {
  it("reports No detected conflict for two independent passing branches", async () => {
    const repository = await createIndependentPair();
    try {
      const outcome = await runPreservedScan(repository, scanConfig(branches));

      expect(outcome.result.exitCode).toBe(0);
      expect(classifications(outcome)).toEqual([
        "BASE_PASS",
        "BRANCH_PASS",
        "BRANCH_PASS",
        "NO_DETECTED_CONFLICT",
      ]);
    } finally {
      await repository.cleanup();
    }
  });

  it("reports a behavioral conflict when independently passing branches fail together", async () => {
    const repository = await createIndependentPair();
    try {
      const outcome = await runPreservedScan(
        repository,
        scanConfig(branches, [validationCommand("test", pairFailureCommandText)]),
      );
      const pair = outcome.result.jobs.find((job) => job.kind === "pair");

      expect(outcome.result.exitCode).toBe(1);
      expect(outcome.result.jobs.filter((job) => job.kind === "branch")).toMatchObject([
        { classification: "BRANCH_PASS" },
        { classification: "BRANCH_PASS" },
      ]);
      expect(pair).toMatchObject({
        classification: "BEHAVIORAL_CONFLICT",
        technicalClassification: "PAIR_TEST_FAILURE",
        conflictedFiles: [],
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("reports a textual Git conflict without running pair commands", async () => {
    const repository = await TemporaryGitRepository.create({
      baseFiles: { "shared.txt": "base\n" },
    });
    try {
      await repository.createBranch("feature/a", { "shared.txt": "branch A\n" });
      await repository.createBranch("feature/b", { "shared.txt": "branch B\n" });

      const outcome = await runPreservedScan(repository, scanConfig(branches));
      const pair = outcome.result.jobs.find((job) => job.kind === "pair");

      expect(outcome.result.exitCode).toBe(1);
      expect(pair).toMatchObject({
        classification: "TEXTUAL_CONFLICT",
        technicalClassification: null,
        commands: [],
        conflictedFiles: ["shared.txt"],
      });
    } finally {
      await repository.cleanup();
    }
  });

  it("stops after an invalid baseline", async () => {
    const repository = await createIndependentPair();
    try {
      const outcome = await runPreservedScan(
        repository,
        scanConfig(branches, [validationCommand("test", 'node -e "process.exit(1)"')]),
      );

      expect(outcome.result.exitCode).toBe(3);
      expect(outcome.result.jobs).toHaveLength(1);
      expect(outcome.result.jobs[0]).toMatchObject({ classification: "INVALID_BASELINE" });
    } finally {
      await repository.cleanup();
    }
  });

  it("classifies an individual failure and emits every affected PAIR_SKIPPED result", async () => {
    const repository = await TemporaryGitRepository.create();
    const selected = ["feature/a", "feature/b", "feature/c"] as const;
    try {
      await repository.createBranch("feature/a", { "a.fail": "fail\n" });
      await repository.createBranch("feature/b", { "b.flag": "pass\n" });
      await repository.createBranch("feature/c", { "c.flag": "pass\n" });
      const outcome = await runPreservedScan(
        repository,
        scanConfig(selected, [
          validationCommand(
            "test",
            "node -e \"process.exit(require('node:fs').existsSync('a.fail') ? 1 : 0)\"",
          ),
        ]),
      );
      const branchJobs = outcome.result.jobs.filter((job) => job.kind === "branch");
      const pairJobs = outcome.result.jobs.filter((job) => job.kind === "pair");

      expect(branchJobs.map((job) => job.classification)).toEqual([
        "BRANCH_TEST_FAILURE",
        "BRANCH_PASS",
        "BRANCH_PASS",
      ]);
      expect(pairJobs.map((job) => [job.branchRefs, job.classification])).toEqual([
        [["feature/a", "feature/b"], "PAIR_SKIPPED"],
        [["feature/a", "feature/c"], "PAIR_SKIPPED"],
        [["feature/b", "feature/c"], "NO_DETECTED_CONFLICT"],
      ]);
      expect(
        pairJobs.slice(0, 2).every((job) => job.skipReason === "INDIVIDUAL_BRANCH_FAILED"),
      ).toBe(true);
    } finally {
      await repository.cleanup();
    }
  });

  it("classifies a pair setup failure without running validation", async () => {
    const repository = await createIndependentPair();
    try {
      const outcome = await runPreservedScan(
        repository,
        scanConfig(branches, [passCommand], {
          setup: { command: pairFailureCommandText, timeoutMs: 5_000 },
        }),
      );
      const pair = outcome.result.jobs.find((job) => job.kind === "pair");

      expect(pair).toMatchObject({
        classification: "BEHAVIORAL_CONFLICT",
        technicalClassification: "PAIR_SETUP_FAILURE",
        failedCommandId: "setup",
      });
      expect(pair?.commands.map((command) => command.id)).toEqual(["setup"]);
    } finally {
      await repository.cleanup();
    }
  });

  it.each([
    ["test", "PAIR_TEST_FAILURE"],
    ["typecheck", "PAIR_TYPECHECK_FAILURE"],
    ["lint", "PAIR_LINT_FAILURE"],
    ["build", "PAIR_BUILD_FAILURE"],
    ["custom", "PAIR_CUSTOM_FAILURE"],
  ] as const)(
    "records %s failure as %s while retaining the behavioral primary cause",
    async (kind, expected) => {
      const repository = await createIndependentPair();
      try {
        const outcome = await runPreservedScan(
          repository,
          scanConfig(branches, [validationCommand(kind, pairFailureCommandText)]),
        );
        const pair = outcome.result.jobs.find((job) => job.kind === "pair");

        expect(pair).toMatchObject({
          classification: "BEHAVIORAL_CONFLICT",
          technicalClassification: expected,
        });
      } finally {
        await repository.cleanup();
      }
    },
  );

  it("times out a pair command, preserves partial evidence, and cleans up", async () => {
    const repository = await createIndependentPair();
    try {
      const outcome = await runPreservedScan(
        repository,
        scanConfig(branches, [
          {
            ...validationCommand(
              "custom",
              "node -e \"const fs=require('node:fs'); if (fs.existsSync('a.flag') && fs.existsSync('b.flag')) { process.stdout.write('before-timeout'); setTimeout(() => {}, 10000); }\"",
            ),
            timeoutMs: 750,
          },
        ]),
      );
      const pair = outcome.result.jobs.find((job) => job.kind === "pair");

      expect(pair).toMatchObject({
        classification: "BEHAVIORAL_CONFLICT",
        technicalClassification: "PAIR_TIMEOUT",
      });
      expect(pair?.commands[0]).toMatchObject({ status: "timed_out", timedOut: true });
      expect(pair?.commands[0]?.stdout.text).toContain("before-timeout");
    } finally {
      await repository.cleanup();
    }
  });

  it("records a missing configured executable as observed baseline command failure", async () => {
    const repository = await createIndependentPair();
    try {
      const outcome = await runPreservedScan(
        repository,
        scanConfig(branches, [
          validationCommand("custom", "branchmesh-executable-that-does-not-exist-7f414b36"),
        ]),
      );
      const command = outcome.result.jobs[0]?.commands[0];

      expect(outcome.result.exitCode).toBe(3);
      expect(outcome.result.jobs[0]?.classification).toBe("INVALID_BASELINE");
      expect(command?.status).toBe("failed");
      expect(command?.exitCode).not.toBe(0);
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects a missing selected ref before creating an execution root", async () => {
    const repository = await TemporaryGitRepository.create();
    await repository.createBranch("feature/a", { "a.flag": "a\n" });
    const stateBefore = await repository.captureState();
    const rootsBefore = await listExecutionRoots();
    try {
      await expect(
        runScan({
          repositoryPath: repository.repositoryPath,
          config: scanConfig(["feature/a", "feature/missing"]),
          toolVersion: "test",
          outputDirectory: repository.outputDirectory,
        }),
      ).rejects.toBeInstanceOf(GitCommandError);

      expect(await repository.captureState()).toEqual(stateBefore);
      expect(await listExecutionRoots()).toEqual(rootsBefore);
    } finally {
      await repository.cleanup();
    }
  });
});

async function createIndependentPair(): Promise<TemporaryGitRepository> {
  const repository = await TemporaryGitRepository.create();
  await repository.createBranch("feature/a", { "a.flag": "a\n" });
  await repository.createBranch("feature/b", { "b.flag": "b\n" });
  return repository;
}

async function runPreservedScan(
  repository: TemporaryGitRepository,
  config: unknown,
): Promise<ScanOutcome> {
  const stateBefore = await repository.captureState();
  const rootsBefore = await listExecutionRoots();
  const outcome = await runScan({
    repositoryPath: repository.repositoryPath,
    config,
    toolVersion: "test",
    outputDirectory: repository.outputDirectory,
  });

  expect(RunResultSchema.parse(outcome.result)).toEqual(outcome.result);
  expect(RunResultSchema.parse(JSON.parse(await readFile(outcome.resultPath, "utf8")))).toEqual(
    outcome.result,
  );
  expect(await repository.captureState()).toEqual(stateBefore);
  expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
  expect(await listExecutionRoots()).toEqual(rootsBefore);
  expect(await pathExists(outcome.executionRoot)).toBe(false);
  return outcome;
}

function validationCommand(kind: ValidationCommandKind, command: string): ValidationCommand {
  return {
    id: kind,
    label: `${kind} command`,
    kind,
    command,
    timeoutMs: 5_000,
  };
}

function classifications(outcome: ScanOutcome): string[] {
  return outcome.result.jobs.map((job) => job.classification);
}
