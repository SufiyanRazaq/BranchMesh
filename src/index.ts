import { Command } from "commander";

import { runDemo } from "./demo/runDemo.js";
import {
  createTerminalProgressReporter,
  renderTerminalSummary,
} from "./terminal/renderTerminal.js";

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
    .description("Run the deterministic three-branch scanning-engine demonstration.")
    .option("--output <directory>", "write reports to this external directory")
    .option("--json", "print machine-readable demo evidence")
    .action(async (commandOptions: DemoCommandOptions) => {
      const outcome = await runDemo({
        toolVersion: BRANCHMESH_VERSION,
        ...(commandOptions.output === undefined ? {} : { outputDirectory: commandOptions.output }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(commandOptions.json === true
          ? {}
          : {
              onProgress: createTerminalProgressReporter((text) => {
                process.stderr.write(text);
              }),
            }),
      });
      const base = outcome.scan.result.jobs.find((job) => job.kind === "base");
      const branches = outcome.scan.result.jobs.filter((job) => job.kind === "branch");
      const pairs = outcome.scan.result.jobs.filter((job) => job.kind === "pair");
      const evidence = {
        scanExitCode: outcome.scan.result.exitCode,
        resultPath: outcome.scan.resultPath,
        htmlPath: outcome.scan.htmlPath,
        logsDirectory: outcome.scan.logsDirectory,
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
        pairs: pairs.map((job) => ({
          refs: job.branchRefs,
          classification: job.classification,
          technicalClassification: job.technicalClassification,
          conflictedFiles: job.conflictedFiles,
        })),
      };

      if (commandOptions.json === true) {
        process.stdout.write(`${JSON.stringify(evidence)}\n`);
      } else {
        process.stdout.write(
          `${renderTerminalSummary(outcome.scan.result, {
            resultPath: outcome.scan.resultPath,
            htmlPath: outcome.scan.htmlPath,
            logsDirectory: outcome.scan.logsDirectory,
          })}\n`,
        );
      }

      process.exitCode = outcome.scan.result.exitCode;
    });

  return program;
}
