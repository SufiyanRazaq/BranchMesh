import pc from "picocolors";

import { createProgram } from "./index.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red("BranchMesh error:")} ${message}\n`);
  process.exitCode = 2;
}
