import { ConfigurationError } from "../model/errors.js";
import { ZodError } from "zod";
import { parseScanConfig, type ScanConfig } from "./schema.js";

export interface ScanConfigOverrides {
  readonly base?: string | undefined;
  readonly branches?: readonly string[] | undefined;
  readonly worktrees?: boolean | undefined;
  readonly ignoreDirty?: boolean | undefined;
}

export function applyScanConfigOverrides(
  config: ScanConfig,
  overrides: ScanConfigOverrides,
): ScanConfig {
  if (overrides.branches !== undefined && overrides.worktrees === true) {
    throw new ConfigurationError("--branches and --worktrees cannot be used together");
  }

  const branches =
    overrides.branches !== undefined
      ? [...overrides.branches]
      : overrides.worktrees === true
        ? Array.isArray(config.branches)
          ? { source: "worktrees" as const, include: ["*"], exclude: [] }
          : config.branches
        : config.branches;

  try {
    return parseScanConfig({
      ...config,
      ...(overrides.base === undefined ? {} : { base: overrides.base }),
      branches,
      execution: {
        ...config.execution,
        ...(overrides.ignoreDirty === undefined ? {} : { ignoreDirty: overrides.ignoreDirty }),
      },
    });
  } catch (error: unknown) {
    const detail =
      error instanceof ZodError
        ? error.issues
            .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
            .join("; ")
        : "unknown validation error";
    throw new ConfigurationError(`CLI overrides are invalid: ${detail}`, { cause: error });
  }
}
