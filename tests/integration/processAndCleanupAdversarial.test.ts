import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runScan } from "../../src/engine/runScan.js";
import { isAbortError } from "../../src/model/errors.js";
import { installRootCancellation, type SignalSource } from "../../src/utils/signals.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";
import {
  listExecutionRoots,
  listReportStagesForOutput,
  pathExists,
  scanConfig,
  waitFor,
} from "../helpers/scanTestSupport.js";

const branches = ["feature/a", "feature/b"] as const;

describe("adversarial process and cleanup behavior", () => {
  it("handles a first and second interruption idempotently while cleaning active worktrees", async () => {
    const repository = await createIndependentPair();
    const source = new EventEmitter() as SignalSource & EventEmitter;
    const cancellation = installRootCancellation(source);
    const stateBefore = await repository.captureState();
    const rootsBefore = await listExecutionRoots();
    let abortEvents = 0;
    cancellation.signal.addEventListener("abort", () => {
      abortEvents += 1;
    });

    try {
      const scanResult = runScan({
        repositoryPath: repository.repositoryPath,
        config: scanConfig(branches, [
          {
            id: "wait",
            label: "Wait for interruption",
            kind: "custom",
            command: 'node -e "setTimeout(() => {}, 10000)"',
            timeoutMs: 20_000,
          },
        ]),
        toolVersion: "test",
        outputDirectory: repository.outputDirectory,
        signal: cancellation.signal,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );

      await waitFor(async () => (await repository.listWorktrees()).length > 1);
      source.emit("SIGINT");
      expect(cancellation.signal.aborted).toBe(true);
      source.emit("SIGTERM");

      const error = await scanResult;
      expect(isAbortError(error)).toBe(true);
      expect(abortEvents).toBe(1);
      expect(await repository.captureState()).toEqual(stateBefore);
      expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
      expect(await listExecutionRoots()).toEqual(rootsBefore);
      expect(await listReportStagesForOutput(repository.outputDirectory)).toEqual([]);
    } finally {
      cancellation.dispose();
      expect(source.listenerCount("SIGINT")).toBe(0);
      expect(source.listenerCount("SIGTERM")).toBe(0);
      await repository.cleanup();
    }
  });

  it("terminates child and grandchild processes before timeout cleanup removes the worktree", async () => {
    const repository = await TemporaryGitRepository.create({
      baseFiles: { "process-tree.cjs": processTreeFixture() },
    });
    const descendantMarker = path.join(repository.root, "descendant-survived.txt");
    const originalMarker = process.env["BRANCHMESH_TEST_DESCENDANT_MARKER"];

    try {
      await repository.createBranch("feature/a", { "a.flag": "a\n" });
      await repository.createBranch("feature/b", { "b.flag": "b\n" });
      process.env["BRANCHMESH_TEST_DESCENDANT_MARKER"] = descendantMarker;
      const stateBefore = await repository.captureState();
      const rootsBefore = await listExecutionRoots();

      const outcome = await runScan({
        repositoryPath: repository.repositoryPath,
        config: scanConfig(branches, [
          {
            id: "process-tree",
            label: "Process tree",
            kind: "custom",
            command: "node process-tree.cjs",
            timeoutMs: 750,
          },
        ]),
        toolVersion: "test",
        outputDirectory: repository.outputDirectory,
      });
      const pair = outcome.result.jobs.find((job) => job.kind === "pair");

      expect(pair).toMatchObject({
        classification: "BEHAVIORAL_CONFLICT",
        technicalClassification: "PAIR_TIMEOUT",
      });
      expect(await repository.captureState()).toEqual(stateBefore);
      expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
      expect(await listExecutionRoots()).toEqual(rootsBefore);
      expect(await listReportStagesForOutput(repository.outputDirectory)).toEqual([]);
      expect(await pathExists(outcome.executionRoot)).toBe(false);

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1_800);
      });
      expect(await pathExists(descendantMarker)).toBe(false);
    } finally {
      restoreEnvironment("BRANCHMESH_TEST_DESCENDANT_MARKER", originalMarker);
      await repository.cleanup();
    }
  });

  it("cleans worktrees before surfacing atomic result-publication failure", async () => {
    const repository = await createIndependentPair();
    const sentinel = "existing user-owned result\n";
    await mkdir(repository.outputDirectory);
    const existingResult = path.join(repository.outputDirectory, "result.json");
    await writeFile(existingResult, sentinel, "utf8");
    const stateBefore = await repository.captureState();
    const rootsBefore = await listExecutionRoots();

    try {
      await expect(
        runScan({
          repositoryPath: repository.repositoryPath,
          config: scanConfig(branches),
          toolVersion: "test",
          outputDirectory: repository.outputDirectory,
        }),
      ).rejects.toMatchObject({ code: "EEXIST" });

      expect(await readFile(existingResult, "utf8")).toBe(sentinel);
      expect(await repository.captureState()).toEqual(stateBefore);
      expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
      expect(await listExecutionRoots()).toEqual(rootsBefore);
      expect(await listReportStagesForOutput(repository.outputDirectory)).toEqual([]);
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

function processTreeFixture(): string {
  const grandchild = [
    "setTimeout(() => {",
    "  require('node:fs').writeFileSync(process.env.BRANCHMESH_TEST_DESCENDANT_MARKER, 'orphan');",
    "}, 1500);",
  ].join("\n");
  const child = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });`,
    "setTimeout(() => {}, 10000);",
  ].join("\n");
  return [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "if (!fs.existsSync('a.flag') || !fs.existsSync('b.flag')) process.exit(0);",
    `spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' });`,
    "setTimeout(() => {}, 10000);",
    "",
  ].join("\n");
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
