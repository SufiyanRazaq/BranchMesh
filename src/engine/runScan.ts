import { parseScanConfig, type ScanConfig } from "../config/schema.js";
import { GitClient } from "../git/GitClient.js";
import { RepositoryInspector, type RepositorySnapshot } from "../git/RepositoryInspector.js";
import { createAbortError } from "../model/errors.js";
import {
  JobResultSchema,
  RunResultSchema,
  type BranchSnapshot,
  type JobResult,
  type RunResult,
} from "../model/results.js";
import { writeValidatedResult } from "../report/writeResult.js";
import {
  createRunId,
  resolveRunOutputDirectory,
  resolveSafeOutputDirectory,
} from "../utils/paths.js";
import { mapLimitOrdered } from "../utils/mapLimitOrdered.js";
import { CommandRunner, type PipelineCommand } from "./CommandRunner.js";
import { planScanJobs, type PairJobPlan } from "./JobPlanner.js";
import { MergeRunner } from "./MergeRunner.js";
import { ExecutionOwnership } from "./ownership.js";
import {
  classifyBaseCommandFailure,
  classifyBranchCommandFailure,
  classifyPairCommandFailure,
} from "./ResultClassifier.js";
import { WorktreeManager } from "./WorktreeManager.js";

export interface ScanOptions {
  readonly repositoryPath: string;
  readonly config: unknown;
  readonly toolVersion: string;
  readonly outputDirectory?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ScanOutcome {
  readonly result: RunResult;
  readonly resultPath: string;
  readonly executionRoot: string;
}

interface JobExecutionContext {
  readonly snapshot: RepositorySnapshot;
  readonly commands: readonly PipelineCommand[];
  readonly maximumLogBytes: number;
  readonly worktrees: WorktreeManager;
  readonly mergeRunner: MergeRunner;
  readonly commandRunner: CommandRunner;
  readonly signal: AbortSignal;
}

export async function runScan(options: ScanOptions): Promise<ScanOutcome> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const config = parseScanConfig(options.config);
  const cancellation = createScanCancellation(options.signal);

  try {
    const git = new GitClient();
    const inspector = new RepositoryInspector(git);
    const snapshot = await inspector.preflight(options.repositoryPath, config, cancellation.signal);
    const runId = createRunId();
    const outputDirectory = await resolveScanOutputDirectory(
      snapshot,
      resolveRunOutputDirectory(
        snapshot.repository.commonGitDirectory,
        runId,
        options.outputDirectory,
      ),
    );
    const ownership = await ExecutionOwnership.create({
      runId,
      repository: snapshot.repository,
      base: snapshot.base,
      branches: snapshot.branches,
    });
    const worktrees = new WorktreeManager(git, snapshot.repository, ownership, cancellation.signal);
    const executionRoot = worktrees.executionRoot;
    const context: JobExecutionContext = {
      snapshot,
      commands: createPipeline(config),
      maximumLogBytes: config.execution.maximumLogBytes,
      worktrees,
      mergeRunner: new MergeRunner(git, ownership, cancellation.signal),
      commandRunner: new CommandRunner(),
      signal: cancellation.signal,
    };

    let result: RunResult | undefined;
    try {
      const baseJob = await executeJob(context, "base", "base", []);
      let jobs: JobResult[] = [baseJob];

      if (baseJob.classification === "BASE_PASS") {
        const plan = planScanJobs(snapshot.branches);
        const schedulingOptions = {
          signal: cancellation.signal,
          onError: (error: unknown) => cancellation.abort(error),
        };
        const branchJobs = await mapLimitOrdered(
          plan.branches,
          config.execution.concurrency,
          async (branchPlan) =>
            await executeJob(context, branchPlan.id, branchPlan.kind, branchPlan.branches),
          schedulingOptions,
        );

        const pairJobs = await mapLimitOrdered(
          plan.pairs,
          config.execution.concurrency,
          async (pairPlan) => {
            const leftPassed = branchJobs[pairPlan.leftIndex]?.classification === "BRANCH_PASS";
            const rightPassed = branchJobs[pairPlan.rightIndex]?.classification === "BRANCH_PASS";
            return leftPassed && rightPassed
              ? await executeJob(context, pairPlan.id, pairPlan.kind, pairPlan.branches)
              : createSkippedPairJob(snapshot.base.sha, pairPlan);
          },
          schedulingOptions,
        );
        jobs = [baseJob, ...branchJobs, ...pairJobs];
      }

      const completedAtMs = Date.now();
      result = createRunResult({
        runId,
        toolVersion: options.toolVersion,
        snapshot,
        jobs,
        concurrency: config.execution.concurrency,
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: Math.max(0, completedAtMs - startedAtMs),
      });
    } finally {
      await worktrees.cleanupAll();
    }

    if (result === undefined) {
      throw new Error("The scan did not produce a result");
    }
    if (cancellation.signal.aborted) {
      throw createAbortError();
    }

    // The writer validates the complete contract again immediately before atomic publication.
    const resultPath = await writeValidatedResult(result, outputDirectory);
    if (cancellation.signal.aborted) {
      throw createAbortError();
    }
    return { result, resultPath, executionRoot };
  } finally {
    cancellation.dispose();
  }
}

async function resolveScanOutputDirectory(
  snapshot: RepositorySnapshot,
  outputDirectory: string,
): Promise<string> {
  let safeOutput = outputDirectory;
  const forbiddenRoots = new Set([
    snapshot.repository.root,
    snapshot.repository.commonGitDirectory,
    ...snapshot.worktrees.filter((worktree) => !worktree.prunable).map((worktree) => worktree.path),
  ]);
  for (const forbiddenRoot of forbiddenRoots) {
    safeOutput = await resolveSafeOutputDirectory(forbiddenRoot, safeOutput);
  }
  return safeOutput;
}

async function executeJob(
  context: JobExecutionContext,
  id: string,
  kind: "base" | "branch" | "pair",
  branches: readonly BranchSnapshot[],
): Promise<JobResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  try {
    const worktreePath = await context.worktrees.create(id, context.snapshot.base.sha);
    const merge = await context.mergeRunner.merge(worktreePath, branches);
    if (!merge.merged) {
      return createJobResult({
        id,
        kind,
        baseSha: context.snapshot.base.sha,
        branches,
        classification: kind === "branch" ? "BASE_MERGE_CONFLICT" : "TEXTUAL_CONFLICT",
        technicalClassification: null,
        skipReason: null,
        conflictedFiles: [...merge.conflictedFiles],
        commands: [],
        startedAt,
        startedAtMs,
      });
    }

    const commands = [];
    for (const command of context.commands) {
      const execution = await context.commandRunner.run(command, worktreePath, {
        signal: context.signal,
        maximumLogBytes: context.maximumLogBytes,
      });
      commands.push(execution.result);
      if (execution.result.status !== "passed") {
        break;
      }
    }
    const failedCommand = commands.at(-1)?.status === "passed" ? undefined : commands.at(-1);

    if (kind === "base") {
      return createJobResult({
        id,
        kind,
        baseSha: context.snapshot.base.sha,
        branches,
        classification:
          failedCommand === undefined ? "BASE_PASS" : classifyBaseCommandFailure(failedCommand),
        technicalClassification: null,
        skipReason: null,
        conflictedFiles: [],
        commands,
        startedAt,
        startedAtMs,
      });
    }

    if (kind === "branch") {
      return createJobResult({
        id,
        kind,
        baseSha: context.snapshot.base.sha,
        branches,
        classification:
          failedCommand === undefined ? "BRANCH_PASS" : classifyBranchCommandFailure(failedCommand),
        technicalClassification: null,
        skipReason: null,
        conflictedFiles: [],
        commands,
        startedAt,
        startedAtMs,
      });
    }

    return createJobResult({
      id,
      kind,
      baseSha: context.snapshot.base.sha,
      branches,
      classification: failedCommand === undefined ? "NO_DETECTED_CONFLICT" : "BEHAVIORAL_CONFLICT",
      technicalClassification:
        failedCommand === undefined ? null : classifyPairCommandFailure(failedCommand),
      skipReason: null,
      conflictedFiles: [],
      commands,
      startedAt,
      startedAtMs,
    });
  } finally {
    await context.worktrees.cleanup(id);
  }
}

interface CreateJobResultOptions {
  readonly id: string;
  readonly kind: "base" | "branch" | "pair";
  readonly baseSha: string;
  readonly branches: readonly BranchSnapshot[];
  readonly classification: JobResult["classification"];
  readonly technicalClassification: JobResult["technicalClassification"];
  readonly skipReason: JobResult["skipReason"];
  readonly conflictedFiles: readonly string[];
  readonly commands: JobResult["commands"];
  readonly startedAt: string;
  readonly startedAtMs: number;
}

function createJobResult(options: CreateJobResultOptions): JobResult {
  const completedAtMs = Date.now();
  const failedCommand =
    options.commands.at(-1)?.status === "passed" ? null : options.commands.at(-1);
  return JobResultSchema.parse({
    id: options.id,
    kind: options.kind,
    baseSha: options.baseSha,
    branchRefs: options.branches.map((branch) => branch.ref),
    branchShas: options.branches.map((branch) => branch.sha),
    mergeOrder: options.branches.map((branch) => branch.ref),
    classification: options.classification,
    technicalClassification: options.technicalClassification,
    skipReason: options.skipReason,
    failedCommandId: failedCommand?.id ?? null,
    conflictedFiles: [...options.conflictedFiles],
    commands: options.commands,
    startedAt: options.startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - options.startedAtMs),
  });
}

function createSkippedPairJob(baseSha: string, plan: PairJobPlan): JobResult {
  const now = new Date().toISOString();
  return JobResultSchema.parse({
    id: plan.id,
    kind: "pair",
    baseSha,
    branchRefs: plan.branches.map((branch) => branch.ref),
    branchShas: plan.branches.map((branch) => branch.sha),
    mergeOrder: plan.branches.map((branch) => branch.ref),
    classification: "PAIR_SKIPPED",
    technicalClassification: null,
    skipReason: "INDIVIDUAL_BRANCH_FAILED",
    failedCommandId: null,
    conflictedFiles: [],
    commands: [],
    startedAt: now,
    completedAt: now,
    durationMs: 0,
  });
}

interface CreateRunResultOptions {
  readonly runId: string;
  readonly toolVersion: string;
  readonly snapshot: RepositorySnapshot;
  readonly jobs: readonly JobResult[];
  readonly concurrency: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

function createRunResult(options: CreateRunResultOptions): RunResult {
  const baseJob = options.jobs[0];
  const branchJobs = options.jobs.filter((job) => job.kind === "branch");
  const pairJobs = options.jobs.filter((job) => job.kind === "pair");
  const exitCode =
    baseJob?.classification !== "BASE_PASS"
      ? 3
      : branchJobs.some((job) => job.classification !== "BRANCH_PASS") ||
          pairJobs.some((job) => job.classification !== "NO_DETECTED_CONFLICT")
        ? 1
        : 0;
  const pairCount = (options.snapshot.branches.length * (options.snapshot.branches.length - 1)) / 2;

  return RunResultSchema.parse({
    schemaVersion: 1,
    runId: options.runId,
    toolVersion: options.toolVersion,
    repositoryRoot: options.snapshot.repository.root,
    commonGitDirectory: options.snapshot.repository.commonGitDirectory,
    runtime: {
      ...options.snapshot.runtime,
      concurrency: options.concurrency,
    },
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    durationMs: options.durationMs,
    exitCode,
    base: options.snapshot.base,
    branches: options.snapshot.branches,
    jobs: options.jobs,
    summary: {
      branchCount: options.snapshot.branches.length,
      pairCount,
      passedBranches: branchJobs.filter((job) => job.classification === "BRANCH_PASS").length,
      failedBranches: branchJobs.filter((job) => job.classification !== "BRANCH_PASS").length,
      passedPairs: pairJobs.filter((job) => job.classification === "NO_DETECTED_CONFLICT").length,
      behavioralConflicts: pairJobs.filter((job) => job.classification === "BEHAVIORAL_CONFLICT")
        .length,
      textualConflicts: pairJobs.filter((job) => job.classification === "TEXTUAL_CONFLICT").length,
      skippedPairs: pairJobs.filter((job) => job.classification === "PAIR_SKIPPED").length,
    },
  });
}

function createPipeline(config: ScanConfig): PipelineCommand[] {
  return [
    ...(config.setup === undefined
      ? []
      : [
          {
            id: "setup",
            label: "Setup",
            kind: "setup" as const,
            command: config.setup.command,
            timeoutMs: config.setup.timeoutMs,
          },
        ]),
    ...config.commands,
  ];
}

function createScanCancellation(parent: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted === true) {
    abort();
  }
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose: () => parent?.removeEventListener("abort", abort),
  };
}
