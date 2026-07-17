import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WorktreeManager } from "../../src/engine/WorktreeManager.js";
import { ExecutionOwnership } from "../../src/engine/ownership.js";
import { GitClient } from "../../src/git/GitClient.js";
import { RepositoryInspector, type RepositorySnapshot } from "../../src/git/RepositoryInspector.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";
import { listExecutionRoots, pathExists, scanConfig } from "../helpers/scanTestSupport.js";

const branches = ["feature/a", "feature/b"] as const;

describe("adversarial execution ownership", () => {
  it("rejects lexical escapes, symlink targets, and symlinked parent containment", async () => {
    const repository = await createIndependentPair();
    const rootsBefore = await listExecutionRoots();
    const snapshot = await inspect(repository);
    const ownership = await createOwnership(snapshot, "containment-test");
    const outsideDirectory = path.join(repository.root, "outside-owned-root");
    await mkdir(outsideDirectory);
    const symlinkPath = path.join(ownership.worktreesDirectory, "escape-link");
    await symlink(outsideDirectory, symlinkPath, "dir");

    try {
      await expect(
        ownership.assertOwnedPath(path.join(ownership.root, "..", "outside-owned-root")),
      ).rejects.toThrow(/outside the BranchMesh execution root/u);
      await expect(ownership.assertOwnedPath(symlinkPath)).rejects.toThrow(/symbolic link/u);
      await expect(ownership.assertOwnedPath(path.join(symlinkPath, "child"))).rejects.toThrow(
        /parent is not canonical/u,
      );
      expect(await pathExists(outsideDirectory)).toBe(true);
    } finally {
      await ownership.removeRoot();
      expect(await pathExists(outsideDirectory)).toBe(true);
      await rm(outsideDirectory, { recursive: true });
      expect(await listExecutionRoots()).toEqual(rootsBefore);
      await repository.cleanup();
    }
  });

  it.each([".branchmesh-owner.json", "manifest.json"])(
    "rejects symlinked ownership metadata at %s",
    async (metadataFileName) => {
      const repository = await createIndependentPair();
      const rootsBefore = await listExecutionRoots();
      const snapshot = await inspect(repository);
      const ownership = await createOwnership(snapshot, `metadata-symlink-${randomUUID()}`);
      const metadataPath = path.join(ownership.root, metadataFileName);
      const originalMetadata = await readFile(metadataPath, "utf8");
      const externalMetadata = path.join(repository.root, `external-${metadataFileName}`);

      try {
        await writeFile(externalMetadata, originalMetadata, "utf8");
        await rm(metadataPath);
        await symlink(externalMetadata, metadataPath);

        await expect(ownership.verify()).rejects.toThrow(/symbolic link/u);
        expect(await pathExists(ownership.root)).toBe(true);
        expect(await readFile(externalMetadata, "utf8")).toBe(originalMetadata);
      } finally {
        await rm(metadataPath, { force: true });
        await writeFile(metadataPath, originalMetadata, "utf8");
        await ownership.removeRoot();
        expect(await readFile(externalMetadata, "utf8")).toBe(originalMetadata);
        await rm(externalMetadata);
        expect(await listExecutionRoots()).toEqual(rootsBefore);
        await repository.cleanup();
      }
    },
  );

  it.each([
    {
      label: "missing ownership marker",
      tamper: async (markerPath: string): Promise<void> => {
        await rm(markerPath);
      },
    },
    {
      label: "corrupt ownership marker",
      tamper: async (markerPath: string): Promise<void> => {
        await writeFile(markerPath, "{not-json\n", "utf8");
      },
    },
    {
      label: "mismatched ownership marker",
      tamper: async (markerPath: string): Promise<void> => {
        const marker = parseRecord(await readFile(markerPath, "utf8"));
        await writeFile(
          markerPath,
          `${JSON.stringify({ ...marker, ownershipToken: randomUUID() })}\n`,
          "utf8",
        );
      },
    },
    {
      label: "mismatched ownership manifest",
      tamper: async (_markerPath: string, manifestPath: string): Promise<void> => {
        const manifest = parseRecord(await readFile(manifestPath, "utf8"));
        await writeFile(
          manifestPath,
          `${JSON.stringify({ ...manifest, repositoryRoot: `${String(manifest["repositoryRoot"])}-mismatch` })}\n`,
          "utf8",
        );
      },
    },
  ])(
    "refuses deletion for a $label and recovers after verified restoration",
    async ({ tamper }) => {
      const repository = await createIndependentPair();
      const rootsBefore = await listExecutionRoots();
      const snapshot = await inspect(repository);
      const stateBefore = await repository.captureState();
      const ownership = await createOwnership(snapshot, `marker-test-${randomUUID()}`);
      const manager = new WorktreeManager(new GitClient(), snapshot.repository, ownership);
      const checkout = await manager.create("marker-job", snapshot.base.sha);
      const markerPath = path.join(ownership.root, ".branchmesh-owner.json");
      const manifestPath = path.join(ownership.root, "manifest.json");
      const originalMarker = await readFile(markerPath, "utf8");
      const originalManifest = await readFile(manifestPath, "utf8");

      try {
        await tamper(markerPath, manifestPath);
        await expect(manager.cleanupAll()).rejects.toThrow();
        expect(await pathExists(ownership.root)).toBe(true);
        expect(await pathExists(checkout)).toBe(true);
        expect(await repository.listWorktrees()).toContain(path.resolve(checkout));

        await writeFile(markerPath, originalMarker, "utf8");
        await writeFile(manifestPath, originalManifest, "utf8");
        await manager.cleanupAll();
        await manager.cleanupAll();

        expect(await pathExists(ownership.root)).toBe(false);
        expect(await repository.captureState()).toEqual(stateBefore);
        expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
        expect(await listExecutionRoots()).toEqual(rootsBefore);
      } finally {
        if (await pathExists(ownership.root)) {
          await writeFile(markerPath, originalMarker, "utf8");
          await writeFile(manifestPath, originalManifest, "utf8");
          await manager.cleanupAll();
        }
        await repository.cleanup();
      }
    },
  );

  it("makes per-job and run-level cleanup idempotent without orphaning Git metadata", async () => {
    const repository = await createIndependentPair();
    const rootsBefore = await listExecutionRoots();
    const snapshot = await inspect(repository);
    const stateBefore = await repository.captureState();
    const ownership = await createOwnership(snapshot, "idempotent-cleanup-test");
    const manager = new WorktreeManager(new GitClient(), snapshot.repository, ownership);

    try {
      await manager.create("idempotent-job", snapshot.base.sha);
      await manager.cleanup("idempotent-job");
      await manager.cleanup("idempotent-job");
      await manager.cleanupAll();
      await manager.cleanupAll();

      expect(await pathExists(ownership.root)).toBe(false);
      expect(await repository.captureState()).toEqual(stateBefore);
      expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
      expect(await listExecutionRoots()).toEqual(rootsBefore);
    } finally {
      if (await pathExists(ownership.root)) {
        await manager.cleanupAll();
      }
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

async function inspect(repository: TemporaryGitRepository): Promise<RepositorySnapshot> {
  return await new RepositoryInspector(new GitClient()).preflight(
    repository.repositoryPath,
    scanConfig(branches),
  );
}

async function createOwnership(
  snapshot: RepositorySnapshot,
  runId: string,
): Promise<ExecutionOwnership> {
  return await ExecutionOwnership.create({
    runId,
    repository: snapshot.repository,
    base: snapshot.base,
    branches: snapshot.branches,
  });
}

function parseRecord(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}
