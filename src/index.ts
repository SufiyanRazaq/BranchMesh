import { Command } from "commander";
import pc from "picocolors";

import { runDemo } from "./demo/runDemo.js";

export const BRANCHMESH_VERSION = "0.0.0";

export interface ProgramOptions {
  readonly signal?: AbortSignal | undefined;
}

interface DemoCommandOptions {
  readonly json?: boolean;
  readonly output?: string;
}

export function createProgram(options: ProgramOptions = {}): Command {
  const program = new Command();

  program
    .name("branchmesh")
    .description("Detect branches that pass independently but fail when combined.")
    .version(BRANCHMESH_VERSION);

  program
    .command("demo")
    .description("Run the deterministic two-branch vertical-slice demonstration.")
    .option("--output <directory>", "write result.json to this external directory")
    .option("--json", "print machine-readable demo evidence")
    .action(async (commandOptions: DemoCommandOptions) => {
      const outcome = await runDemo({
        toolVersion: BRANCHMESH_VERSION,
        ...(commandOptions.output === undefined ? {} : { outputDirectory: commandOptions.output }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      const base = outcome.scan.result.jobs.find((job) => job.kind === "base");
      const branches = outcome.scan.result.jobs.filter((job) => job.kind === "branch");
      const pair = outcome.scan.result.jobs.find((job) => job.kind === "pair");
      const evidence = {
        scanExitCode: outcome.scan.result.exitCode,
        resultPath: outcome.scan.resultPath,
        executionRoot: outcome.scan.executionRoot,
        demoRoot: outcome.demoRoot,
        demoRepository: outcome.demoRepository,
        repositoryUnchanged: outcome.repositoryUnchanged,
        temporaryWorktreesRemaining: outcome.temporaryWorktreesRemaining,
        base: base?.classification,
        branches: branches.map((job) => ({
          ref: job.branchRefs[0],
          classification: job.classification,
        })),
        pair: {
          classification: pair?.classification,
          technicalClassification: pair?.technicalClassification,
          conflictedFiles: pair?.conflictedFiles ?? [],
        },
      };

      if (commandOptions.json === true) {
        process.stdout.write(`${JSON.stringify(evidence)}\n`);
      } else {
        process.stdout.write(
          [
            pc.bold(pc.cyan("BranchMesh vertical-slice demo")),
            `Base: ${formatClassification(base?.classification)}`,
            ...branches.map(
              (job) =>
                `${job.branchRefs[0] ?? "unknown branch"}: ${formatClassification(job.classification)}`,
            ),
            `Combined: ${formatClassification(pair?.classification)}`,
            `Technical classification: ${pair?.technicalClassification ?? "none"}`,
            `Result: ${outcome.scan.resultPath}`,
          ].join("\n") + "\n",
        );
      }

      process.exitCode = outcome.scan.result.exitCode;
    });

  return program;
}

function formatClassification(classification: string | undefined): string {
  if (classification === undefined) {
    return pc.red("missing");
  }
  return classification.endsWith("PASS") || classification === "NO_DETECTED_CONFLICT"
    ? pc.green(classification)
    : pc.red(classification);
}
