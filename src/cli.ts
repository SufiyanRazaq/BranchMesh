import pc from "picocolors";

import { createProgram } from "./index.js";

const cancellation = new AbortController();
const cancel = (): void => cancellation.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);

try {
  await createProgram({ signal: cancellation.signal }).parseAsync(process.argv);
} catch (error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    process.stderr.write(`${pc.yellow("BranchMesh interrupted.")}\n`);
    process.exitCode = 130;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${pc.red("BranchMesh error:")} ${message}\n`);
    process.exitCode = 2;
  }
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
