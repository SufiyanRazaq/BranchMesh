import pc from "picocolors";
import { CommanderError } from "commander";

import { cliErrorExitCode } from "./commands/cliErrors.js";
import { createProgram } from "./index.js";
import { BranchMeshError, isAbortError } from "./model/errors.js";
import { installRootCancellation } from "./utils/signals.js";

const cancellation = installRootCancellation(process);

try {
  const argumentsWithDefaultHelp =
    process.argv.length === 2 ? [...process.argv, "--help"] : process.argv;
  await createProgram({ signal: cancellation.signal }).parseAsync(argumentsWithDefaultHelp);
} catch (error: unknown) {
  if (error instanceof CommanderError) {
    process.exitCode = cliErrorExitCode(error);
  } else if (isAbortError(error)) {
    process.stderr.write(`${pc.yellow("BranchMesh interrupted.")}\n`);
    process.exitCode = cliErrorExitCode(error);
  } else if (error instanceof BranchMeshError) {
    process.stderr.write(`${pc.red("BranchMesh error:")} ${error.message}\n`);
    process.exitCode = cliErrorExitCode(error);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${pc.red("BranchMesh error:")} ${message}\n`);
    process.exitCode = cliErrorExitCode(error);
  }
} finally {
  cancellation.dispose();
}
