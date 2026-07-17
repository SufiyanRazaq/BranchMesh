import { Command } from "commander";
import pc from "picocolors";

export const BRANCHMESH_VERSION = "0.0.0";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("branchmesh")
    .description("Detect branches that pass independently but fail when combined.")
    .version(BRANCHMESH_VERSION)
    .action(() => {
      process.stdout.write(`${pc.cyan("BranchMesh")} repository foundation is ready.\n`);
    });

  return program;
}
