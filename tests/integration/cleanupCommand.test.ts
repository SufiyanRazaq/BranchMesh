import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cleanExecutionRoots } from "../../src/engine/CleanupManager.js";
import { WorktreeManager } from "../../src/engine/WorktreeManager.js";
import { ExecutionOwnership, executionLockFileName } from "../../src/engine/ownership.js";
import { GitClient } from "../../src/git/GitClient.js";
import { RepositoryInspector, type RepositorySnapshot } from "../../src/git/RepositoryInspector.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";
import { scanConfig, waitFor } from "../helpers/scanTestSupport.js";

const staleProcessId = 2_147_483_647;

describe("owned orphan cleanup", () => {
  it("is a dry run by default and exactly removes a proven stale idle worktree when confirmed", async () => {
    const repository = await createScannableRepository();
    const before = await repository.captureState();
    const snapshot = await snapshotRepository(repository);
    const ownership = await createOwnership(snapshot, "cleanup-stale");
    const manager = new WorktreeManager(new GitClient(), snapshot.repository, ownership);
    const checkout = await manager.create("orphan-job", snapshot.base.sha);
    const originalLock = await makeLockStale(ownership.root);
    const rootName = path.basename(ownership.root);

    try {
      const dryRun = await cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: false,
      });
      expect(dryRun.entries.find((entry) => entry.name === rootName)).toMatchObject({
        status: "would-remove",
      });
      expect(await pathExists(ownership.root)).toBe(true);
      expect(await pathExists(checkout)).toBe(true);

      const cleaned = await cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: true,
      });
      expect(cleaned.entries.find((entry) => entry.name === rootName)).toMatchObject({
        status: "removed",
      });
      expect(await pathExists(ownership.root)).toBe(false);
      expect(await repository.captureState()).toEqual(before);

      const repeated = await cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: true,
      });
      expect(repeated.entries.some((entry) => entry.name === rootName)).toBe(false);
    } finally {
      if (await pathExists(ownership.root)) {
        await writeFile(path.join(ownership.root, executionLockFileName), originalLock, "utf8");
        await manager.cleanupAll();
      }
      await repository.cleanup();
    }
  });

  it("retains live, corrupt, and non-idle matching roots", async () => {
    const repository = await createScannableRepository();
    const snapshot = await snapshotRepository(repository);
    const ownership = await createOwnership(snapshot, "cleanup-refusal");
    const manager = new WorktreeManager(new GitClient(), snapshot.repository, ownership);
    await manager.create("uncertain-job", snapshot.base.sha);
    const lockPath = path.join(ownership.root, executionLockFileName);
    const originalLock = await readFile(lockPath, "utf8");
    const rootName = path.basename(ownership.root);

    try {
      const live = await cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: true,
      });
      expect(live.entries.find((entry) => entry.name === rootName)).toMatchObject({
        status: "live",
      });
      expect(await pathExists(ownership.root)).toBe(true);

      await manager.setActivity("uncertain-job", "command");
      await makeLockStale(ownership.root);
      const uncertain = await cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: true,
      });
      expect(uncertain.entries.find((entry) => entry.name === rootName)).toMatchObject({
        status: "uncertain",
      });
      expect(await pathExists(ownership.root)).toBe(true);

      await writeFile(lockPath, "{not-json\n", "utf8");
      const refused = await cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: true,
      });
      expect(refused.entries.find((entry) => entry.name === rootName)).toMatchObject({
        status: "refused",
      });
      expect(refused.ownershipFailures).toBeGreaterThan(0);
      expect(await pathExists(ownership.root)).toBe(true);
    } finally {
      await writeFile(lockPath, originalLock, "utf8");
      await manager.setActivity("uncertain-job", "idle");
      await manager.cleanupAll();
      await repository.cleanup();
    }
  });

  it("finishes an ownership-critical removal but reports a signal received during cleanup", async () => {
    const repository = await createScannableRepository();
    const before = await repository.captureState();
    const isolatedTemporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "branchmesh-clean-signal-test-"),
    );
    const originalTemporaryDirectory = process.env["TMPDIR"];
    let ownership: ExecutionOwnership | undefined;
    let manager: WorktreeManager | undefined;
    let originalLock: string | undefined;

    try {
      const snapshot = await snapshotRepository(repository);
      process.env["TMPDIR"] = isolatedTemporaryDirectory;
      try {
        ownership = await createOwnership(snapshot, "cleanup-cancelled");
      } finally {
        restoreEnvironment("TMPDIR", originalTemporaryDirectory);
      }
      manager = new WorktreeManager(new GitClient(), snapshot.repository, ownership);
      for (let index = 0; index < 5; index += 1) {
        await manager.create(`orphan-job-${String(index)}`, snapshot.base.sha);
      }
      originalLock = await makeLockStale(ownership.root);
      const controller = new AbortController();
      const claimPath = path.join(ownership.root, ".branchmesh-cleanup-claim.json");
      expect(await readdir(isolatedTemporaryDirectory)).toEqual([path.basename(ownership.root)]);
      const cleanup = cleanExecutionRoots({
        repositoryPath: repository.repositoryPath,
        execute: true,
        signal: controller.signal,
        temporaryDirectory: isolatedTemporaryDirectory,
      });
      await waitFor(async () => await pathExists(claimPath));
      controller.abort();

      await expect(cleanup).rejects.toMatchObject({ name: "AbortError" });
      expect(controller.signal.aborted).toBe(true);
      expect(await pathExists(ownership.root)).toBe(false);
      expect(await repository.captureState()).toEqual(before);
    } finally {
      if (
        ownership !== undefined &&
        manager !== undefined &&
        originalLock !== undefined &&
        (await pathExists(ownership.root))
      ) {
        await writeFile(path.join(ownership.root, executionLockFileName), originalLock, "utf8");
        process.env["TMPDIR"] = isolatedTemporaryDirectory;
        try {
          await manager.cleanupAll();
        } finally {
          restoreEnvironment("TMPDIR", originalTemporaryDirectory);
        }
      }
      await repository.cleanup();
      await rm(isolatedTemporaryDirectory, { recursive: true });
    }
  });
});

async function createScannableRepository(): Promise<TemporaryGitRepository> {
  const repository = await TemporaryGitRepository.create();
  await repository.createBranch("feature/a", { "a.txt": "a\n" });
  await repository.createBranch("feature/b", { "b.txt": "b\n" });
  return repository;
}

async function snapshotRepository(repository: TemporaryGitRepository): Promise<RepositorySnapshot> {
  return await new RepositoryInspector(new GitClient()).preflight(
    repository.repositoryPath,
    scanConfig(["feature/a", "feature/b"]),
  );
}

async function createOwnership(snapshot: RepositorySnapshot, runId: string) {
  return await ExecutionOwnership.create({
    runId,
    repository: snapshot.repository,
    base: snapshot.base,
    branches: snapshot.branches,
  });
}

async function makeLockStale(root: string): Promise<string> {
  const lockPath = path.join(root, executionLockFileName);
  const original = await readFile(lockPath, "utf8");
  const parsed = JSON.parse(original) as Record<string, unknown>;
  await writeFile(
    lockPath,
    `${JSON.stringify({ ...parsed, processId: staleProcessId })}\n`,
    "utf8",
  );
  return original;
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

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
