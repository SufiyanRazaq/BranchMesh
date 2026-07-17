import pc from "picocolors";

import { createProgram } from "./index.js";
import { BranchMeshError, isAbortError } from "./model/errors.js";
import { installRootCancellation } from "./utils/signals.js";

const cancellation = installRootCancellation(process);

try {
  await createProgram({ signal: cancellation.signal }).parseAsync(process.argv);
} catch (error: unknown) {
  if (isAbortError(error)) {
    process.stderr.write(`${pc.yellow("BranchMesh interrupted.")}\n`);
    process.exitCode = 130;
  } else if (error instanceof BranchMeshError) {
    process.stderr.write(`${pc.red("BranchMesh error:")} ${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${pc.red("BranchMesh error:")} ${message}\n`);
    process.exitCode = 2;
  }
} finally {
  cancellation.dispose();
}
