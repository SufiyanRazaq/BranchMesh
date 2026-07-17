import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";

import { GitClient } from "../git/GitClient.js";
import { RepositoryInspector, type RepositoryIdentity } from "../git/RepositoryInspector.js";
import { ConfigurationError } from "../model/errors.js";
import { parseScanConfig, type ScanConfig } from "./schema.js";

export const configFileName = "branchmesh.config.json";

export interface LoadedScanConfig {
  readonly repository: RepositoryIdentity;
  readonly configPath: string;
  readonly config: ScanConfig;
}

export async function loadScanConfig(
  repositoryPath: string,
  signal?: AbortSignal,
): Promise<LoadedScanConfig> {
  const git = new GitClient();
  const repository = await new RepositoryInspector(git).resolveRepositoryRoot(
    repositoryPath,
    signal,
  );
  const configPath = path.join(repository.root, configFileName);
  let source: string;
  try {
    source = await readRegularTextFile(configPath, "configuration");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ConfigurationError(
        `No ${configFileName} was found at the repository root; run branchmesh init`,
        { cause: error },
      );
    }
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(`Could not read ${configFileName}`, { cause: error });
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error: unknown) {
    throw new ConfigurationError(`${configFileName} is not valid JSON`, { cause: error });
  }

  try {
    return { repository, configPath, config: parseScanConfig(input) };
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new ConfigurationError(`${configFileName} is invalid: ${formatZodIssues(error)}`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function readRegularTextFile(filePath: string, label: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (metadata.isSymbolicLink()) {
    throw new ConfigurationError(`The BranchMesh ${label} may not be a symbolic link`);
  }
  if (!metadata.isFile()) {
    throw new ConfigurationError(`The BranchMesh ${label} must be a regular file`);
  }

  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new ConfigurationError(`The BranchMesh ${label} may not be a symbolic link`, {
        cause: error,
      });
    }
    throw error;
  }

  try {
    if (!(await handle.stat()).isFile()) {
      throw new ConfigurationError(`The BranchMesh ${label} must be a regular file`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .map(
      (issue) =>
        `${issue.path.length === 0 ? "configuration" : issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
