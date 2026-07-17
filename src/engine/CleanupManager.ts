import { randomUUID } from "node:crypto";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertGitSuccess, GitClient } from "../git/GitClient.js";
import { RepositoryInspector, type RepositoryIdentity } from "../git/RepositoryInspector.js";
import { parseWorktreePorcelainZ, type DiscoveredWorktree } from "../git/WorktreeParser.js";
import { InfrastructureError, createAbortError } from "../model/errors.js";
import { isPathInside } from "../utils/paths.js";
import {
  ExecutionLockSchema,
  OwnershipMarkerSchema,
  RunManifestSchema,
  executionLockFileName,
  executionManifestFileName,
  executionMarkerFileName,
  readRegularOwnershipFile,
  type ExecutionLock,
  type OwnershipMarker,
  type RunManifest,
} from "./ownership.js";

const executionRootPrefix = "branchmesh-run-";
const cleanupClaimFileName = ".branchmesh-cleanup-claim.json";

export interface CleanupOptions {
  readonly repositoryPath: string;
  readonly execute: boolean;
  readonly signal?: AbortSignal | undefined;
  readonly temporaryDirectory?: string | undefined;
}

export type CleanupEntryStatus = "would-remove" | "removed" | "live" | "uncertain" | "refused";

export interface CleanupEntry {
  readonly name: string;
  readonly status: CleanupEntryStatus;
  readonly detail: string;
}

export interface CleanupOutcome {
  readonly repository: RepositoryIdentity;
  readonly dryRun: boolean;
  readonly entries: readonly CleanupEntry[];
  readonly ownershipFailures: number;
}

interface RootEvidence {
  readonly root: string;
  readonly marker: OwnershipMarker;
  readonly lock: ExecutionLock;
  readonly manifest: RunManifest;
}

export async function cleanExecutionRoots(options: CleanupOptions): Promise<CleanupOutcome> {
  const git = new GitClient();
  const repository = await new RepositoryInspector(git).resolveRepositoryRoot(
    options.repositoryPath,
    options.signal,
  );
  const temporaryDirectory = await realpath(options.temporaryDirectory ?? os.tmpdir());
  const entries: CleanupEntry[] = [];
  let ownershipFailures = 0;

  for (const directoryEntry of (await readdir(temporaryDirectory, { withFileTypes: true })).sort(
    (left, right) => compareText(left.name, right.name),
  )) {
    throwIfAborted(options.signal);
    if (!directoryEntry.name.startsWith(executionRootPrefix)) {
      continue;
    }
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
      entries.push({
        name: directoryEntry.name,
        status: "uncertain",
        detail: "ambiguous temporary entry was not inspected or removed",
      });
      continue;
    }

    const root = path.join(temporaryDirectory, directoryEntry.name);
    let marker: OwnershipMarker;
    try {
      marker = OwnershipMarkerSchema.parse(
        JSON.parse(
          await readRegularOwnershipFile(
            path.join(root, executionMarkerFileName),
            "ownership marker",
          ),
        ),
      );
    } catch {
      entries.push({
        name: directoryEntry.name,
        status: "uncertain",
        detail: "missing or corrupt ownership marker; nothing was removed",
      });
      continue;
    }
    if (marker.commonGitDirectory !== repository.commonGitDirectory) {
      continue;
    }

    let evidence: RootEvidence;
    try {
      evidence = await readEvidence(root, marker, temporaryDirectory);
    } catch (error: unknown) {
      ownershipFailures += 1;
      entries.push({
        name: directoryEntry.name,
        status: "refused",
        detail: safeErrorMessage(error, "ownership evidence is invalid"),
      });
      continue;
    }

    const lockState = inspectProcessLock(evidence.lock.processId);
    if (lockState !== "stale") {
      entries.push({
        name: directoryEntry.name,
        status: lockState,
        detail:
          lockState === "live"
            ? "run process is still live; nothing was removed"
            : "run-process state is uncertain; nothing was removed",
      });
      continue;
    }

    const registered = await listRepositoryWorktrees(
      git,
      repository,
      temporaryDirectory,
      options.signal,
    );
    try {
      assertRegisteredMembership(evidence, registered);
    } catch (error: unknown) {
      ownershipFailures += 1;
      entries.push({
        name: directoryEntry.name,
        status: "refused",
        detail: safeErrorMessage(error, "Git worktree ownership is invalid"),
      });
      continue;
    }
    if (
      evidence.manifest.worktrees.some((record) => record.activity !== "idle") ||
      hasUncertainWorktreeLock(evidence, registered)
    ) {
      entries.push({
        name: directoryEntry.name,
        status: "uncertain",
        detail: "an owned process or Git worktree lock is uncertain; nothing was removed",
      });
      continue;
    }

    if (!options.execute) {
      entries.push({
        name: directoryEntry.name,
        status: "would-remove",
        detail: `${String(evidence.manifest.worktrees.length)} recorded worktree(s)`,
      });
      continue;
    }

    try {
      await removeOwnedRoot(git, repository, evidence, temporaryDirectory, options.signal);
      entries.push({
        name: directoryEntry.name,
        status: "removed",
        detail: "owned orphan execution root removed",
      });
    } catch (error: unknown) {
      ownershipFailures += 1;
      entries.push({
        name: directoryEntry.name,
        status: "refused",
        detail: safeErrorMessage(error, "safe cleanup could not be completed"),
      });
    }
  }

  return { repository, dryRun: !options.execute, entries, ownershipFailures };
}

async function readEvidence(
  root: string,
  expectedMarker: OwnershipMarker,
  temporaryDirectory: string,
): Promise<RootEvidence> {
  const canonicalRoot = await realpath(root);
  if (
    canonicalRoot !== root ||
    !isPathInside(temporaryDirectory, canonicalRoot) ||
    !path.basename(canonicalRoot).startsWith(executionRootPrefix)
  ) {
    throw new InfrastructureError("Execution-root containment could not be proven");
  }
  const metadata = await lstat(canonicalRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new InfrastructureError("Execution root is not a regular directory");
  }
  for (const directoryName of ["hooks", "worktrees"] as const) {
    const directoryPath = path.join(canonicalRoot, directoryName);
    const directoryMetadata = await lstat(directoryPath);
    if (
      directoryMetadata.isSymbolicLink() ||
      !directoryMetadata.isDirectory() ||
      (await realpath(directoryPath)) !== directoryPath
    ) {
      throw new InfrastructureError(`Execution ${directoryName} directory is not canonical`);
    }
  }

  const marker = OwnershipMarkerSchema.parse(
    JSON.parse(
      await readRegularOwnershipFile(
        path.join(canonicalRoot, executionMarkerFileName),
        "ownership marker",
      ),
    ),
  );
  const lock = ExecutionLockSchema.parse(
    JSON.parse(
      await readRegularOwnershipFile(path.join(canonicalRoot, executionLockFileName), "run lock"),
    ),
  );
  const manifest = RunManifestSchema.parse(
    JSON.parse(
      await readRegularOwnershipFile(
        path.join(canonicalRoot, executionManifestFileName),
        "run manifest",
      ),
    ),
  );

  for (const [label, expected, actual] of [
    ["marker token", expectedMarker.ownershipToken, marker.ownershipToken],
    ["marker run ID", expectedMarker.runId, marker.runId],
    ["lock token", marker.ownershipToken, lock.ownershipToken],
    ["lock run ID", marker.runId, lock.runId],
    ["manifest token", marker.ownershipToken, manifest.ownershipToken],
    ["manifest run ID", marker.runId, manifest.runId],
    ["manifest repository root", marker.repositoryRoot, manifest.repositoryRoot],
    ["manifest common Git directory", marker.commonGitDirectory, manifest.commonGitDirectory],
  ] as const) {
    if (expected !== actual) {
      throw new InfrastructureError(`Execution ownership ${label} does not match`);
    }
  }

  const jobIds = new Set<string>();
  const worktreePaths = new Set<string>();
  for (const record of manifest.worktrees) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(record.jobId) ||
      jobIds.has(record.jobId) ||
      worktreePaths.has(record.path)
    ) {
      throw new InfrastructureError("The worktree manifest has duplicate or invalid identities");
    }
    jobIds.add(record.jobId);
    worktreePaths.add(record.path);
    const resolvedPath = path.resolve(record.path);
    const expectedPath = path.join(canonicalRoot, "worktrees", record.jobId, "checkout");
    if (
      resolvedPath !== record.path ||
      resolvedPath !== expectedPath ||
      !isPathInside(canonicalRoot, resolvedPath)
    ) {
      throw new InfrastructureError("A recorded worktree path is outside its execution root");
    }
    const parent = path.dirname(resolvedPath);
    const parentMetadata = await lstatOrUndefined(parent);
    if (parentMetadata !== undefined) {
      const canonicalParent = await realpath(parent);
      if (
        parentMetadata.isSymbolicLink() ||
        !parentMetadata.isDirectory() ||
        canonicalParent !== parent ||
        !isPathInside(canonicalRoot, canonicalParent)
      ) {
        throw new InfrastructureError("A recorded worktree parent is not canonical");
      }
    }
    try {
      const worktreeMetadata = await lstat(resolvedPath);
      if (worktreeMetadata.isSymbolicLink() || !worktreeMetadata.isDirectory()) {
        throw new InfrastructureError("A recorded worktree path is not a regular directory");
      }
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return { root: canonicalRoot, marker, lock, manifest };
}

async function removeOwnedRoot(
  git: GitClient,
  repository: RepositoryIdentity,
  expected: RootEvidence,
  temporaryDirectory: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  const claimToken = randomUUID();
  const claimPath = path.join(expected.root, cleanupClaimFileName);
  await createCleanupClaim(claimPath, expected, claimToken);
  try {
    const evidence = await readEvidence(expected.root, expected.marker, temporaryDirectory);
    if (
      evidence.lock.processId !== expected.lock.processId ||
      evidence.marker.ownershipToken !== expected.marker.ownershipToken ||
      inspectProcessLock(evidence.lock.processId) !== "stale" ||
      evidence.manifest.worktrees.some((record) => record.activity !== "idle")
    ) {
      throw new InfrastructureError("Execution lock changed or is no longer provably stale");
    }

    // Once the exclusive claim exists, finish this exact root's critical cleanup before observing
    // cancellation. This avoids leaving a half-removed Git worktree registration.
    let registered = await listRepositoryWorktrees(git, repository, temporaryDirectory, undefined);
    assertRegisteredMembership(evidence, registered);
    if (hasUncertainWorktreeLock(evidence, registered)) {
      throw new InfrastructureError("An owned Git worktree became locked or uncertain");
    }
    for (const record of [...evidence.manifest.worktrees].reverse()) {
      if (!registered.some((worktree) => path.resolve(worktree.path) === record.path)) {
        continue;
      }
      const removal = await git.run(
        ["--git-dir", repository.commonGitDirectory, "worktree", "remove", "--force", record.path],
        { cwd: evidence.root },
      );
      assertGitSuccess(removal, `Owned orphan worktree removal for ${record.jobId}`);
      registered = await listRepositoryWorktrees(git, repository, temporaryDirectory, undefined);
      if (registered.some((worktree) => path.resolve(worktree.path) === record.path)) {
        throw new InfrastructureError("Git still lists an owned worktree after exact removal");
      }
    }

    const finalRegistered = await listRepositoryWorktrees(
      git,
      repository,
      temporaryDirectory,
      undefined,
    );
    if (
      finalRegistered.some((worktree) => isPathInside(evidence.root, path.resolve(worktree.path)))
    ) {
      throw new InfrastructureError("An unrecorded Git worktree remains inside the execution root");
    }
    await readEvidence(evidence.root, evidence.marker, temporaryDirectory);
    await rm(evidence.root, { recursive: true });
  } catch (error: unknown) {
    await removeCleanupClaim(claimPath, expected.marker.ownershipToken, claimToken);
    throw error;
  }
}

async function listRepositoryWorktrees(
  git: GitClient,
  repository: RepositoryIdentity,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<DiscoveredWorktree[]> {
  const result = assertGitSuccess(
    await git.run(
      ["--git-dir", repository.commonGitDirectory, "worktree", "list", "--porcelain", "-z"],
      { cwd, signal },
    ),
    "Git worktree discovery for cleanup",
  );
  return parseWorktreePorcelainZ(result.stdout);
}

function hasUncertainWorktreeLock(
  evidence: RootEvidence,
  registered: readonly DiscoveredWorktree[],
): boolean {
  const recorded = new Set(evidence.manifest.worktrees.map((record) => record.path));
  return registered.some(
    (worktree) => recorded.has(path.resolve(worktree.path)) && worktree.locked,
  );
}

function assertRegisteredMembership(
  evidence: RootEvidence,
  registered: readonly DiscoveredWorktree[],
): void {
  const records = new Map(evidence.manifest.worktrees.map((record) => [record.path, record]));
  for (const worktree of registered) {
    const worktreePath = path.resolve(worktree.path);
    if (!isPathInside(evidence.root, worktreePath)) {
      continue;
    }
    const record = records.get(worktreePath);
    if (record === undefined || record.state === "removed") {
      throw new InfrastructureError(
        "Git lists an unexpected or already-removed worktree inside the execution root",
      );
    }
  }
}

async function createCleanupClaim(
  claimPath: string,
  evidence: RootEvidence,
  claimToken: string,
): Promise<void> {
  let handle;
  try {
    handle = await open(claimPath, "wx", 0o600);
  } catch (error: unknown) {
    throw new InfrastructureError("Another cleanup claim exists or could not be created", {
      cause: error,
    });
  }
  try {
    await handle.writeFile(
      `${JSON.stringify({
        schemaVersion: 1,
        owner: "branchmesh-clean",
        ownershipToken: evidence.marker.ownershipToken,
        claimToken,
        processId: process.pid,
      })}\n`,
      "utf8",
    );
  } catch (error: unknown) {
    await handle.close();
    await rm(claimPath, { force: true });
    throw new InfrastructureError("Another cleanup claim exists or could not be created", {
      cause: error,
    });
  }
  await handle.close();
}

async function removeCleanupClaim(
  claimPath: string,
  ownershipToken: string,
  claimToken: string,
): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readRegularOwnershipFile(claimPath, "cleanup claim"));
    if (
      !isRecord(parsed) ||
      parsed["owner"] !== "branchmesh-clean" ||
      parsed["ownershipToken"] !== ownershipToken ||
      parsed["claimToken"] !== claimToken
    ) {
      return;
    }
    await rm(claimPath);
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function lstatOrUndefined(
  candidate: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(candidate);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectProcessLock(processId: number): "live" | "stale" | "uncertain" {
  try {
    process.kill(processId, 0);
    return "live";
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return "stale";
    }
    return "uncertain";
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createAbortError("BranchMesh clean was cancelled");
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
