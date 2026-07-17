import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ScanConfig } from "../../src/config/schema.js";
import type { ValidationCommand } from "../../src/config/schema.js";

export const passCommand: ValidationCommand = {
  id: "pass",
  label: "Pass",
  kind: "custom",
  command: 'node -e "process.exit(0)"',
  timeoutMs: 5_000,
};

export function scanConfig(
  branches: readonly string[],
  commands: readonly ValidationCommand[] = [passCommand],
  overrides: {
    readonly setup?: ScanConfig["setup"] | undefined;
    readonly concurrency?: 1 | 2 | undefined;
    readonly maximumLogBytes?: number | undefined;
  } = {},
): ScanConfig {
  return {
    base: "main",
    branches: [...branches],
    ...(overrides.setup === undefined ? {} : { setup: overrides.setup }),
    commands: [...commands],
    execution: {
      maxBranches: 5,
      concurrency: overrides.concurrency ?? 1,
      failFast: false,
      skipPairsWithFailedBranches: true,
      ignoreDirty: false,
      maximumLogBytes: overrides.maximumLogBytes ?? 4_096,
    },
  };
}

export async function listExecutionRoots(): Promise<string[]> {
  return (await readdir(os.tmpdir()))
    .filter((entry) => entry.startsWith("branchmesh-run-"))
    .sort(compareText);
}

export async function listReportStagesForOutput(outputDirectory: string): Promise<string[]> {
  const matching: string[] = [];
  for (const entry of await readdir(os.tmpdir())) {
    if (!entry.startsWith("branchmesh-report-stage-")) {
      continue;
    }
    const stageRoot = path.join(os.tmpdir(), entry);
    try {
      const marker = JSON.parse(
        await readFile(path.join(stageRoot, ".branchmesh-report-stage.json"), "utf8"),
      ) as { outputDirectory?: unknown };
      if (marker.outputDirectory === path.resolve(outputDirectory)) {
        matching.push(stageRoot);
      }
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
  return matching.sort(compareText);
}

export async function pathExists(candidate: string): Promise<boolean> {
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

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`Condition was not met within ${String(timeoutMs)} ms`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
