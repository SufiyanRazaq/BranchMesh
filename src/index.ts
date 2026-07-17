import os from "node:os";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import pc from "picocolors";

import { runDoctor } from "./commands/doctor.js";
import { initializeConfiguration } from "./config/initialize.js";
import { loadScanConfig } from "./config/loader.js";
import { applyScanConfigOverrides, type ScanConfigOverrides } from "./config/overrides.js";
import { runDemo } from "./demo/runDemo.js";
import { cleanExecutionRoots } from "./engine/CleanupManager.js";
import { runScan } from "./engine/runScan.js";
import { assertGitSuccess, GitClient } from "./git/GitClient.js";
import { parseGitVersion } from "./git/RepositoryInspector.js";
import { InfrastructureError } from "./model/errors.js";
import {
  createTerminalProgressReporter,
  renderTerminalSummary,
} from "./terminal/renderTerminal.js";
import { openLocalFile } from "./utils/openLocalFile.js";
import packageMetadata from "../package.json" with { type: "json" };

export const BRANCHMESH_VERSION = packageMetadata.version;

export interface ProgramOptions {
  readonly signal?: AbortSignal | undefined;
  readonly cwd?: string | undefined;
  readonly stdout?: ((text: string) => void) | undefined;
  readonly stderr?: ((text: string) => void) | undefined;
  readonly setExitCode?: ((exitCode: number) => void) | undefined;
}

interface SharedSelectionOptions {
  readonly base?: string;
  readonly branches?: readonly string[];
  readonly worktrees?: boolean;
  readonly ignoreDirty?: boolean;
  readonly output?: string;
}

interface ScanCommandOptions extends SharedSelectionOptions {
  readonly open?: boolean;
}

interface DemoCommandOptions {
  readonly json?: boolean;
  readonly output?: string;
  readonly open?: boolean;
}

interface InitCommandOptions {
  readonly force?: boolean;
}

interface CleanCommandOptions {
  readonly yes?: boolean;
  readonly force?: boolean;
}

export function createProgram(options: ProgramOptions = {}): Command {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const writeOut = options.stdout ?? ((text: string) => process.stdout.write(text));
  const writeErr = options.stderr ?? ((text: string) => process.stderr.write(text));
  const setExitCode = options.setExitCode ?? ((exitCode: number) => (process.exitCode = exitCode));
  const program = new Command();

  program
    .name("branchmesh")
    .description("Detect branches that pass independently but fail when combined.")
    .version(BRANCHMESH_VERSION, "-V, --version", "print the BranchMesh package version")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({ writeOut, writeErr })
    .addHelpText(
      "after",
      `\nExamples:\n  branchmesh init\n  branchmesh doctor\n  branchmesh scan --base main --branches feature/a,feature/b\n  branchmesh demo\n  branchmesh clean\n  branchmesh version\n`,
    );

  program
    .command("init")
    .description("Create branchmesh.config.json from package scripts and lockfiles.")
    .option("--force", "replace an existing regular configuration file")
    .addHelpText("after", `\nExamples:\n  branchmesh init\n  branchmesh init --force\n`)
    .action(async (commandOptions: InitCommandOptions) => {
      const outcome = await initializeConfiguration({
        repositoryPath: cwd,
        force: commandOptions.force === true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      writeOut(`${pc.green("CREATED")} ${outcome.configPath}\n`);
      writeOut(`Package manager: ${outcome.packageManager}\n`);
      writeOut(
        `Validation commands: ${outcome.config.commands.map((command) => command.command).join(", ")}\n`,
      );
      setExitCode(0);
    });

  const doctor = program
    .command("doctor")
    .description("Run read-only environment, repository, and configuration checks.")
    .option("--output <directory>", "validate this external report location");
  addSelectionOptions(doctor);
  doctor
    .addHelpText(
      "after",
      `\nExamples:\n  branchmesh doctor\n  branchmesh doctor --base main --branches feature/a,feature/b\n  branchmesh doctor --worktrees\n`,
    )
    .action(async (commandOptions: SharedSelectionOptions) => {
      const loaded = await loadScanConfig(cwd, options.signal);
      const config = applyScanConfigOverrides(loaded.config, commandOverrides(commandOptions));
      const outcome = await runDoctor({
        repositoryPath: loaded.repository.root,
        config,
        ...(commandOptions.output === undefined
          ? {}
          : { outputDirectory: resolveInvocationPath(cwd, commandOptions.output) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      for (const check of outcome.checks) {
        const label = check.status === "pass" ? pc.green("PASS") : pc.yellow("WARN");
        writeOut(`${label} ${check.label}: ${check.detail}\n`);
      }
      setExitCode(0);
    });

  const scan = program
    .command("scan")
    .description("Scan selected branches and publish terminal, JSON, log, and HTML evidence.")
    .option("--output <directory>", "write reports to this external directory")
    .option("--open", "open the generated offline HTML report after publication");
  addSelectionOptions(scan);
  scan
    .addHelpText(
      "after",
      `\nExamples:\n  branchmesh scan --base main --branches feature/a,feature/b\n  branchmesh scan --worktrees --open\n  branchmesh scan --output ../branchmesh-output\n`,
    )
    .action(async (commandOptions: ScanCommandOptions) => {
      const loaded = await loadScanConfig(cwd, options.signal);
      const config = applyScanConfigOverrides(loaded.config, commandOverrides(commandOptions));
      const outcome = await runScan({
        repositoryPath: loaded.repository.root,
        config,
        toolVersion: BRANCHMESH_VERSION,
        ...(commandOptions.output === undefined
          ? {}
          : { outputDirectory: resolveInvocationPath(cwd, commandOptions.output) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onProgress: createTerminalProgressReporter(writeErr),
      });
      writeOut(
        `${renderTerminalSummary(outcome.result, {
          resultPath: outcome.resultPath,
          htmlPath: outcome.htmlPath,
          logsDirectory: outcome.logsDirectory,
        })}\n`,
      );
      if (commandOptions.open === true) {
        await openLocalFile(outcome.htmlPath, options.signal);
      }
      setExitCode(outcome.result.exitCode);
    });

  program
    .command("demo")
    .description("Create and scan the deterministic hidden-conflict demonstration repository.")
    .option("--output <directory>", "write reports to this external directory")
    .option("--json", "print machine-readable demo evidence")
    .option("--open", "open the generated offline HTML report after publication")
    .addHelpText(
      "after",
      `\nExamples:\n  branchmesh demo\n  branchmesh demo --json --output /tmp/branchmesh-demo-report\n`,
    )
    .action(async (commandOptions: DemoCommandOptions) => {
      const outcome = await runDemo({
        toolVersion: BRANCHMESH_VERSION,
        ...(commandOptions.output === undefined
          ? {}
          : { outputDirectory: resolveInvocationPath(cwd, commandOptions.output) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(commandOptions.json === true
          ? {}
          : { onProgress: createTerminalProgressReporter(writeErr) }),
      });
      const evidence = createDemoEvidence(outcome);
      if (commandOptions.json === true) {
        writeOut(`${JSON.stringify(evidence)}\n`);
      } else {
        writeOut(
          `${renderTerminalSummary(outcome.scan.result, {
            resultPath: outcome.scan.resultPath,
            htmlPath: outcome.scan.htmlPath,
            logsDirectory: outcome.scan.logsDirectory,
          })}\n`,
        );
      }
      if (commandOptions.open === true) {
        await openLocalFile(outcome.scan.htmlPath, options.signal);
      }
      setExitCode(outcome.scan.result.exitCode);
    });

  program
    .command("clean")
    .description(
      "Inspect or remove only provably owned orphan execution roots for this repository.",
    )
    .option("--yes", "confirm removal of safely identified stale roots")
    .option("--force", "confirm removal; never bypasses ownership or live-lock checks")
    .addHelpText(
      "after",
      `\nExamples:\n  branchmesh clean                 # dry run\n  branchmesh clean --yes           # remove proven stale roots\n  branchmesh clean --force         # same confirmation, never bypasses safety checks\n`,
    )
    .action(async (commandOptions: CleanCommandOptions) => {
      const outcome = await cleanExecutionRoots({
        repositoryPath: cwd,
        execute: commandOptions.yes === true || commandOptions.force === true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (outcome.entries.length === 0) {
        writeOut("No BranchMesh execution roots for this repository were found.\n");
      } else {
        for (const entry of outcome.entries) {
          writeOut(`${entry.status.toUpperCase()} ${entry.name}: ${entry.detail}\n`);
        }
        if (outcome.dryRun) {
          writeOut("Dry run only. Use --yes or --force to remove proven stale roots.\n");
        }
      }
      setExitCode(outcome.ownershipFailures > 0 ? 2 : 0);
    });

  program
    .command("version")
    .description("Print BranchMesh, Node.js, Git, and operating-system versions.")
    .action(async () => {
      const gitOutput = assertGitSuccess(
        await new GitClient().run(["--version"], {
          cwd: os.tmpdir(),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
        "Git version discovery",
      ).stdout;
      let gitVersion: string;
      try {
        gitVersion = parseGitVersion(gitOutput).version;
      } catch (error: unknown) {
        throw new InfrastructureError("Git returned an unrecognized version", { cause: error });
      }
      writeOut(`BranchMesh ${BRANCHMESH_VERSION}\n`);
      writeOut(`Node.js ${process.versions.node}\n`);
      writeOut(`Git ${gitVersion}\n`);
      writeOut(`Operating system ${os.platform()} ${os.release()} ${os.arch()}\n`);
      setExitCode(0);
    });

  return program;
}

function addSelectionOptions(command: Command): void {
  command
    .option("--base <ref>", "override the configured base reference")
    .option("--branches <refs>", "comma-separated local branches", parseBranchList)
    .option("--worktrees", "select matching branches checked out in active worktrees")
    .option("--ignore-dirty", "allow selected active worktrees to be dirty")
    .option("--no-ignore-dirty", "require selected active worktrees to be clean");
}

function parseBranchList(value: string): readonly string[] {
  const branches = value.split(",").map((branch) => branch.trim());
  if (branches.some((branch) => branch.length === 0)) {
    throw new InvalidArgumentError("branch references must be a non-empty comma-separated list");
  }
  return branches;
}

function commandOverrides(options: SharedSelectionOptions): ScanConfigOverrides {
  return {
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.branches === undefined ? {} : { branches: options.branches }),
    ...(options.worktrees === undefined ? {} : { worktrees: options.worktrees }),
    ...(options.ignoreDirty === undefined ? {} : { ignoreDirty: options.ignoreDirty }),
  };
}

function createDemoEvidence(outcome: Awaited<ReturnType<typeof runDemo>>) {
  const base = outcome.scan.result.jobs.find((job) => job.kind === "base");
  const branches = outcome.scan.result.jobs.filter((job) => job.kind === "branch");
  const pairs = outcome.scan.result.jobs.filter((job) => job.kind === "pair");
  return {
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
}

function resolveInvocationPath(cwd: string, candidate: string): string {
  return path.resolve(cwd, candidate);
}
