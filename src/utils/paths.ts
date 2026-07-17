import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function createRunId(now = new Date()): string {
  const timestamp = now
    .toISOString()
    .replaceAll(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function createRepositoryFingerprint(commonGitDirectory: string): string {
  return createHash("sha256").update(commonGitDirectory).digest("hex").slice(0, 16);
}

export function resolveUserDataRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "BranchMesh");
  }

  if (process.platform === "linux") {
    const configuredRoot = environment["XDG_DATA_HOME"];
    return configuredRoot === undefined || configuredRoot.length === 0
      ? path.join(os.homedir(), ".local", "share", "branchmesh")
      : path.resolve(configuredRoot, "branchmesh");
  }

  throw new Error(`BranchMesh does not support platform ${process.platform} in the MVP`);
}

export function resolveRunOutputDirectory(
  commonGitDirectory: string,
  runId: string,
  explicitOutput: string | undefined,
): string {
  return resolveReportDirectories(commonGitDirectory, runId, explicitOutput).runDirectory;
}

export interface ReportDirectories {
  readonly runDirectory: string;
  readonly latestDirectory: string | null;
}

export function resolveReportDirectories(
  commonGitDirectory: string,
  runId: string,
  explicitOutput: string | undefined,
  dataRoot = resolveUserDataRoot(),
): ReportDirectories {
  if (explicitOutput !== undefined) {
    return { runDirectory: path.resolve(explicitOutput), latestDirectory: null };
  }

  const repositoryDirectory = path.join(
    dataRoot,
    "repositories",
    createRepositoryFingerprint(commonGitDirectory),
  );
  return {
    runDirectory: path.join(repositoryDirectory, "runs", runId),
    latestDirectory: path.join(repositoryDirectory, "latest"),
  };
}

export async function resolveSafeOutputDirectory(
  repositoryRoot: string,
  outputDirectory: string,
): Promise<string> {
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const canonicalOutputDirectory = await resolveThroughExistingAncestor(outputDirectory);
  if (
    canonicalOutputDirectory === canonicalRepositoryRoot ||
    isPathInside(canonicalRepositoryRoot, canonicalOutputDirectory)
  ) {
    throw new Error("BranchMesh output must be outside the scanned repository");
  }
  return canonicalOutputDirectory;
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

async function resolveThroughExistingAncestor(candidate: string): Promise<string> {
  let existingAncestor = path.resolve(candidate);
  const missingSegments: string[] = [];

  for (;;) {
    try {
      return path.join(await realpath(existingAncestor), ...missingSegments);
    } catch (error: unknown) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw error;
      }
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
