import { CommanderError } from "commander";

import { BranchMeshError, isAbortError, type BranchMeshExitCode } from "../model/errors.js";

export function cliErrorExitCode(error: unknown): Exclude<BranchMeshExitCode, 1> {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? 0 : 2;
  }
  if (isAbortError(error)) {
    return 130;
  }
  if (error instanceof BranchMeshError) {
    return error.exitCode;
  }
  return 2;
}
