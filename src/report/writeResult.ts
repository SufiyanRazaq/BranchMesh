import { randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { RunResultSchema, type RunResult } from "../model/results.js";

export async function writeValidatedResult(
  result: RunResult,
  outputDirectory: string,
): Promise<string> {
  const validatedResult = RunResultSchema.parse(result);
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  await mkdir(resolvedOutputDirectory, { recursive: true, mode: 0o700 });

  const resultPath = path.join(resolvedOutputDirectory, "result.json");
  const temporaryPath = path.join(resolvedOutputDirectory, `.result-${randomUUID()}.json.tmp`);

  try {
    await writeFile(temporaryPath, `${JSON.stringify(validatedResult, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // A hard link publishes the complete file atomically and fails if result.json exists.
    await link(temporaryPath, resultPath);
    await rm(temporaryPath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return resultPath;
}
