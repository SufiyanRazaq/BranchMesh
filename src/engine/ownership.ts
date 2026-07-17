import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { BranchSnapshotSchema, type BranchSnapshot } from "../model/results.js";
import { isPathInside } from "../utils/paths.js";
import type { RepositoryIdentity } from "../git/RepositoryInspector.js";

const markerFileName = ".branchmesh-owner.json";
const manifestFileName = "manifest.json";

const OwnershipMarkerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  owner: z.literal("branchmesh"),
  runId: z.string().min(1),
  ownershipToken: z.string().uuid(),
  repositoryRoot: z.string().min(1),
  commonGitDirectory: z.string().min(1),
  createdAt: z.string().min(1),
});

const WorktreeRecordSchema = z.strictObject({
  jobId: z.string().min(1),
  path: z.string().min(1),
  state: z.enum(["planned", "active", "removed"]),
});

const RunManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  ownershipToken: z.string().uuid(),
  repositoryRoot: z.string().min(1),
  commonGitDirectory: z.string().min(1),
  base: BranchSnapshotSchema,
  branches: z.tuple([BranchSnapshotSchema, BranchSnapshotSchema]),
  worktrees: z.array(WorktreeRecordSchema),
});

type OwnershipMarker = z.infer<typeof OwnershipMarkerSchema>;
type RunManifest = z.infer<typeof RunManifestSchema>;
export type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;

export interface ExecutionOwnershipOptions {
  readonly runId: string;
  readonly repository: RepositoryIdentity;
  readonly base: BranchSnapshot;
  readonly branches: readonly [BranchSnapshot, BranchSnapshot];
}

export class ExecutionOwnership {
  public readonly root: string;
  public readonly hooksDirectory: string;
  public readonly worktreesDirectory: string;

  readonly #marker: OwnershipMarker;
  #manifest: RunManifest;

  private constructor(root: string, marker: OwnershipMarker, manifest: RunManifest) {
    this.root = root;
    this.hooksDirectory = path.join(root, "hooks");
    this.worktreesDirectory = path.join(root, "worktrees");
    this.#marker = marker;
    this.#manifest = manifest;
  }

  public static async create(options: ExecutionOwnershipOptions): Promise<ExecutionOwnership> {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "branchmesh-run-")));
    try {
      await chmod(root, 0o700);

      const marker = OwnershipMarkerSchema.parse({
        schemaVersion: 1,
        owner: "branchmesh",
        runId: options.runId,
        ownershipToken: randomUUID(),
        repositoryRoot: options.repository.root,
        commonGitDirectory: options.repository.commonGitDirectory,
        createdAt: new Date().toISOString(),
      });
      const manifest = RunManifestSchema.parse({
        schemaVersion: 1,
        runId: options.runId,
        ownershipToken: marker.ownershipToken,
        repositoryRoot: options.repository.root,
        commonGitDirectory: options.repository.commonGitDirectory,
        base: options.base,
        branches: options.branches,
        worktrees: [],
      });

      const ownership = new ExecutionOwnership(root, marker, manifest);
      await mkdir(ownership.hooksDirectory, { mode: 0o700 });
      await mkdir(ownership.worktreesDirectory, { mode: 0o700 });
      await writeJsonAtomically(path.join(root, markerFileName), marker);
      await ownership.#persistManifest();
      return ownership;
    } catch (error: unknown) {
      await removeFailedInitialization(root);
      throw error;
    }
  }

  public get worktrees(): readonly WorktreeRecord[] {
    return this.#manifest.worktrees;
  }

  public async registerWorktree(jobId: string, worktreePath: string): Promise<void> {
    await this.verify();
    await this.assertOwnedPath(worktreePath);

    if (this.#manifest.worktrees.some((record) => record.jobId === jobId)) {
      throw new Error(`Worktree job ${jobId} is already registered`);
    }

    this.#manifest = RunManifestSchema.parse({
      ...this.#manifest,
      worktrees: [...this.#manifest.worktrees, { jobId, path: worktreePath, state: "planned" }],
    });
    await this.#persistManifest();
  }

  public async updateWorktreeState(jobId: string, state: WorktreeRecord["state"]): Promise<void> {
    await this.verify();
    const index = this.#manifest.worktrees.findIndex((record) => record.jobId === jobId);
    if (index === -1) {
      throw new Error(`Worktree job ${jobId} is not registered`);
    }

    this.#manifest = RunManifestSchema.parse({
      ...this.#manifest,
      worktrees: this.#manifest.worktrees.map((record, recordIndex) =>
        recordIndex === index ? { ...record, state } : record,
      ),
    });
    await this.#persistManifest();
  }

  public findWorktree(jobId: string): WorktreeRecord | undefined {
    return this.#manifest.worktrees.find((record) => record.jobId === jobId);
  }

  public async verify(): Promise<void> {
    const actualRoot = await realpath(this.root);
    if (actualRoot !== this.root) {
      throw new Error("Execution root identity changed");
    }

    const marker = OwnershipMarkerSchema.parse(
      JSON.parse(await readFile(path.join(this.root, markerFileName), "utf8")),
    );
    const manifest = RunManifestSchema.parse(
      JSON.parse(await readFile(path.join(this.root, manifestFileName), "utf8")),
    );

    for (const [name, expected, actual] of [
      ["run ID", this.#marker.runId, marker.runId],
      ["ownership token", this.#marker.ownershipToken, marker.ownershipToken],
      ["repository root", this.#marker.repositoryRoot, marker.repositoryRoot],
      ["common Git directory", this.#marker.commonGitDirectory, marker.commonGitDirectory],
      ["manifest run ID", this.#marker.runId, manifest.runId],
      ["manifest ownership token", this.#marker.ownershipToken, manifest.ownershipToken],
      ["manifest repository root", this.#marker.repositoryRoot, manifest.repositoryRoot],
      [
        "manifest common Git directory",
        this.#marker.commonGitDirectory,
        manifest.commonGitDirectory,
      ],
    ] as const) {
      if (expected !== actual) {
        throw new Error(`Execution ownership ${name} does not match`);
      }
    }

    this.#manifest = manifest;
  }

  public async assertOwnedPath(candidate: string): Promise<void> {
    const resolvedCandidate = path.resolve(candidate);
    if (!isPathInside(this.root, resolvedCandidate)) {
      throw new Error(`Path is outside the BranchMesh execution root: ${resolvedCandidate}`);
    }

    const parent = path.dirname(resolvedCandidate);
    const actualParent = await realpath(parent);
    if (actualParent !== parent || !isPathInside(this.root, actualParent)) {
      throw new Error(`Owned path parent is not canonical: ${parent}`);
    }

    const candidateStat = await lstatOrUndefined(resolvedCandidate);
    if (candidateStat?.isSymbolicLink() === true) {
      throw new Error(`Owned path may not be a symbolic link: ${resolvedCandidate}`);
    }

    if (candidateStat !== undefined) {
      const actualCandidate = await realpath(resolvedCandidate);
      if (!isPathInside(this.root, actualCandidate)) {
        throw new Error(`Owned path resolves outside the execution root: ${resolvedCandidate}`);
      }
    }
  }

  public async removeRoot(): Promise<void> {
    await this.verify();

    if (this.#manifest.worktrees.some((record) => record.state !== "removed")) {
      throw new Error("Cannot remove an execution root with registered worktrees remaining");
    }

    const canonicalTemporaryDirectory = await realpath(os.tmpdir());
    if (!isPathInside(canonicalTemporaryDirectory, this.root)) {
      throw new Error("Execution root is not beneath os.tmpdir()");
    }

    await rm(this.root, { recursive: true });
  }

  async #persistManifest(): Promise<void> {
    await writeJsonAtomically(path.join(this.root, manifestFileName), this.#manifest);
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function lstatOrUndefined(
  filePath: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function removeFailedInitialization(root: string): Promise<void> {
  const canonicalTemporaryDirectory = await realpath(os.tmpdir());
  if (
    !isPathInside(canonicalTemporaryDirectory, root) ||
    !path.basename(root).startsWith("branchmesh-run-")
  ) {
    throw new Error("Refusing to remove an invalid BranchMesh initialization directory");
  }
  await rm(root, { recursive: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
