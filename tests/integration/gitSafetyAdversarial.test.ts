import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runScan, type ScanOutcome } from "../../src/engine/runScan.js";
import { RunResultSchema } from "../../src/model/results.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";
import {
  listExecutionRoots,
  passCommand,
  pathExists,
  scanConfig,
  waitFor,
} from "../helpers/scanTestSupport.js";

const ordinaryBranches = ["feature/a", "feature/b"] as const;

describe("adversarial Git safety", () => {
  it("rejects a dirty selected worktree and leaves that user worktree untouched", async () => {
    const repository = await createIndependentPair();
    const selectedWorktree = await repository.addWorktree("user worktree", "feature/a");
    await writeFile(
      path.join(selectedWorktree, "untracked user file.txt"),
      "preserve me\n",
      "utf8",
    );
    const repositoryBefore = await repository.captureState();
    const selectedBefore = await repository.captureWorktreeState(selectedWorktree);
    const rootsBefore = await listExecutionRoots();

    try {
      await expect(
        runScan({
          repositoryPath: repository.repositoryPath,
          config: scanConfig(ordinaryBranches),
          toolVersion: "test",
          outputDirectory: repository.outputDirectory,
        }),
      ).rejects.toMatchObject({ exitCode: 4 });

      expect(await repository.captureState()).toEqual(repositoryBefore);
      expect(await repository.captureWorktreeState(selectedWorktree)).toEqual(selectedBefore);
      expect(await repository.listWorktrees()).toContain(path.resolve(selectedWorktree));
      expect(await listExecutionRoots()).toEqual(rootsBefore);
    } finally {
      await repository.cleanup();
    }
  });

  it("supports repository and file paths containing spaces and non-ASCII characters", async () => {
    const repository = await TemporaryGitRepository.create({
      repositoryDirectoryName: "repository with spaces — 仓库",
      baseFiles: { "base folder/naïve file.txt": "base\n" },
    });
    const selected = ["feature/naïve", "feature/路径"] as const;
    try {
      await repository.createBranch("feature/naïve", {
        "folder with spaces/élément.txt": "a\n",
      });
      await repository.createBranch("feature/路径", { "资料/状态.txt": "b\n" });

      const outcome = await runPreservedScan(repository, scanConfig(selected));

      expect(outcome.result.exitCode).toBe(0);
      expect(outcome.result.branches.map((branch) => branch.ref)).toEqual([
        "feature/naïve",
        "feature/路径",
      ]);
      expect(outcome.result.branches.flatMap((branch) => branch.changedFiles)).toEqual([
        "folder with spaces/élément.txt",
        "资料/状态.txt",
      ]);
    } finally {
      await repository.cleanup();
    }
  });

  it("treats hostile but valid branch names as opaque Git argv values", async () => {
    const repository = await TemporaryGitRepository.create();
    const markerName = `branchmesh-hostile-${randomUUID()}`;
    const markerPath = path.join(os.tmpdir(), markerName);
    const hostileA = `feature/$(touch\${IFS}${markerPath})`;
    const hostileB = `feature/semicolon;touch\${IFS}${markerPath}`;

    try {
      expect(await pathExists(markerPath)).toBe(false);
      await repository.createBranch(hostileA, { "hostile-a.flag": "a\n" });
      await repository.createBranch(hostileB, { "hostile-b.flag": "b\n" });

      const outcome = await runPreservedScan(
        repository,
        scanConfig([hostileB, hostileA], [passCommand]),
      );

      expect(outcome.result.exitCode).toBe(0);
      expect(new Set(outcome.result.branches.map((branch) => branch.ref))).toEqual(
        new Set([hostileA, hostileB]),
      );
      expect(await pathExists(markerPath)).toBe(false);
    } finally {
      await rm(markerPath, { force: true });
      await repository.cleanup();
    }
  });

  it("continues using captured commit IDs after a selected branch ref moves", async () => {
    const repository = await createIndependentPair();
    const oldBranchSha = await repository.resolveCommit("feature/a");
    const movedBranchSha = await repository.createBranch("feature/moved-target", {
      "moved.flag": "must not be scanned\n",
    });
    const repositoryBefore = await repository.captureState();
    const rootsBefore = await listExecutionRoots();
    let refMoved = false;

    try {
      const scan = runScan({
        repositoryPath: repository.repositoryPath,
        config: scanConfig(ordinaryBranches, [
          {
            id: "snapshot-guard",
            label: "Snapshot guard",
            kind: "custom",
            command:
              "node -e \"const fs=require('node:fs'); const base=!fs.existsSync('a.flag')&&!fs.existsSync('b.flag'); if (base) setTimeout(() => {}, 1000); process.exitCode=fs.existsSync('moved.flag') ? 1 : 0\"",
            timeoutMs: 5_000,
          },
        ]),
        toolVersion: "test",
        outputDirectory: repository.outputDirectory,
      });

      await waitFor(async () => (await repository.listWorktrees()).length > 1);
      await repository.runGit(["update-ref", "refs/heads/feature/a", movedBranchSha, oldBranchSha]);
      refMoved = true;

      const outcome = await scan;
      expect(outcome.result.exitCode).toBe(0);
      expect(outcome.result.branches.find((branch) => branch.ref === "feature/a")?.sha).toBe(
        oldBranchSha,
      );
      expect(
        outcome.result.jobs.find((job) => job.branchRefs[0] === "feature/a")?.branchShas[0],
      ).toBe(oldBranchSha);

      await repository.runGit(["update-ref", "refs/heads/feature/a", oldBranchSha, movedBranchSha]);
      refMoved = false;
      expect(await repository.captureState()).toEqual(repositoryBefore);
      expect(await listExecutionRoots()).toEqual(rootsBefore);
    } finally {
      if (refMoved) {
        await repository.runGit([
          "update-ref",
          "refs/heads/feature/a",
          oldBranchSha,
          movedBranchSha,
        ]);
      }
      await repository.cleanup();
    }
  });

  it("leaves an existing clean user worktree and its administrative record unchanged", async () => {
    const repository = await createIndependentPair();
    const userWorktree = await repository.addWorktree("existing user worktree", "feature/a");
    const repositoryBefore = await repository.captureState();
    const userWorktreeBefore = await repository.captureWorktreeState(userWorktree);

    try {
      const outcome = await runScan({
        repositoryPath: repository.repositoryPath,
        config: scanConfig(ordinaryBranches),
        toolVersion: "test",
        outputDirectory: repository.outputDirectory,
      });

      expect(outcome.result.exitCode).toBe(0);
      expect(await repository.captureState()).toEqual(repositoryBefore);
      expect(await repository.captureWorktreeState(userWorktree)).toEqual(userWorktreeBefore);
      expect(await repository.listWorktrees()).toContain(path.resolve(userWorktree));
    } finally {
      await repository.cleanup();
    }
  });

  it("disables repository hooks for worktree creation and synthetic merges", async () => {
    const repository = await createIndependentPair();
    const hooksDirectory = path.join(repository.root, "hostile-user-hooks");
    const hookMarker = path.join(repository.root, "hook-ran.txt");
    const hookScript = `#!/bin/sh\nprintf '%s\\n' hook-ran >> '${hookMarker}'\n`;

    try {
      await mkdir(hooksDirectory, { mode: 0o700 });
      for (const hookName of [
        "post-checkout",
        "pre-merge-commit",
        "prepare-commit-msg",
        "commit-msg",
        "post-merge",
      ]) {
        const hookPath = path.join(hooksDirectory, hookName);
        await writeFile(hookPath, hookScript, "utf8");
        await chmod(hookPath, 0o700);
      }
      await repository.runGit(["config", "--local", "core.hooksPath", hooksDirectory]);

      const outcome = await runPreservedScan(repository, scanConfig(ordinaryBranches));

      expect(outcome.result.exitCode).toBe(0);
      expect(await pathExists(hookMarker)).toBe(false);
      expect((await repository.runGit(["config", "--local", "core.hooksPath"])).stdout.trim()).toBe(
        hooksDirectory,
      );
    } finally {
      await repository.cleanup();
    }
  });

  it("does not require Git signing for synthetic merge commits", async () => {
    const repository = await createIndependentPair();
    try {
      await repository.runGit(["config", "--local", "commit.gpgSign", "true"]);
      await repository.runGit(["config", "--local", "user.signingKey", "missing-test-key"]);

      const outcome = await runPreservedScan(repository, scanConfig(ordinaryBranches));

      expect(outcome.result.exitCode).toBe(0);
      expect((await repository.runGit(["config", "--local", "commit.gpgSign"])).stdout.trim()).toBe(
        "true",
      );
    } finally {
      await repository.cleanup();
    }
  });

  it("does not depend on global Git identity and never serializes environment values", async () => {
    const repository = await createIndependentPair();
    const emptyGlobalConfig = path.join(repository.root, "empty-global-gitconfig");
    const secret = `must-not-be-reported-${randomUUID()}`;
    const originalGlobalConfig = process.env["GIT_CONFIG_GLOBAL"];
    const originalNoSystem = process.env["GIT_CONFIG_NOSYSTEM"];
    const originalSecret = process.env["BRANCHMESH_TEST_SECRET"];

    try {
      await writeFile(emptyGlobalConfig, "", "utf8");
      await repository.runGit(["config", "--local", "user.useConfigOnly", "true"]);
      process.env["GIT_CONFIG_GLOBAL"] = emptyGlobalConfig;
      process.env["GIT_CONFIG_NOSYSTEM"] = "1";
      process.env["BRANCHMESH_TEST_SECRET"] = secret;

      const outcome = await runPreservedScan(repository, scanConfig(ordinaryBranches));
      const published = await readFile(outcome.resultPath, "utf8");

      expect(outcome.result.exitCode).toBe(0);
      expect(published).not.toContain(secret);
      expect(JSON.stringify(outcome.result)).not.toContain(secret);
    } finally {
      restoreEnvironment("GIT_CONFIG_GLOBAL", originalGlobalConfig);
      restoreEnvironment("GIT_CONFIG_NOSYSTEM", originalNoSystem);
      restoreEnvironment("BRANCHMESH_TEST_SECRET", originalSecret);
      await repository.cleanup();
    }
  });

  it("preserves dirty tracked and untracked original files when ignoreDirty scans commits", async () => {
    const repository = await createIndependentPair();
    try {
      await repository.writeFiles({
        "base.txt": "local tracked edit\n",
        "untracked user file.txt": "local untracked content\n",
      });
      const config = scanConfig(ordinaryBranches);
      const outcome = await runPreservedScan(repository, {
        ...config,
        execution: { ...config.execution, ignoreDirty: true },
      });

      expect(outcome.result.exitCode).toBe(0);
      expect(outcome.result.base.dirty).toBe(true);
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
  expect(await repository.captureState()).toEqual(stateBefore);
  expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
  expect(await listExecutionRoots()).toEqual(rootsBefore);
  expect(await pathExists(outcome.executionRoot)).toBe(false);
  return outcome;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
