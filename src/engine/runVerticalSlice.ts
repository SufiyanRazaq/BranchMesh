import type { ValidationCommand } from "../config/schema.js";
import { parseVerticalSliceConfig } from "../config/schema.js";
import { GitClient } from "../git/GitClient.js";
import { RepositoryInspector, type RepositorySnapshot } from "../git/RepositoryInspector.js";
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
import { CommandRunner } from "./CommandRunner.js";
import { MergeRunner } from "./MergeRunner.js";
import { ExecutionOwnership } from "./ownership.js";
import { classifyBranchCommandFailure, classifyPairCommandFailure } from "./ResultClassifier.js";
import { WorktreeManager } from "./WorktreeManager.js";

export interface VerticalSliceOptions {
  readonly repositoryPath: string;
  readonly config: unknown;
  readonly toolVersion: string;
  readonly outputDirectory?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface VerticalSliceOutcome {
  readonly result: RunResult;
  readonly resultPath: string;
  readonly executionRoot: string;
}

interface JobExecutionContext {
  readonly snapshot: RepositorySnapshot;
  readonly command: ValidationCommand;
  readonly worktrees: WorktreeManager;
  readonly mergeRunner: MergeRunner;
  readonly commandRunner: CommandRunner;
  readonly signal: AbortSignal | undefined;
}

export async function runVerticalSlice(
  options: VerticalSliceOptions,
): Promise<VerticalSliceOutcome> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const config = parseVerticalSliceConfig(options.config);
  const git = new GitClient();
  const inspector = new RepositoryInspector(git);

  // All refs become immutable commit IDs before any execution directory or job is created.
  const snapshot = await inspector.snapshot(options.repositoryPath, config, options.signal);
  const runId = createRunId();
  const outputDirectory = await resolveSafeOutputDirectory(
    snapshot.repository.root,
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
  const worktrees = new WorktreeManager(git, snapshot.repository, ownership, options.signal);
  const executionRoot = worktrees.executionRoot;
  const context: JobExecutionContext = {
    snapshot,
    command: config.commands[0],
    worktrees,
    mergeRunner: new MergeRunner(git, ownership, options.signal),
    commandRunner: new CommandRunner(),
    signal: options.signal,
  };

  let result: RunResult | undefined;
  try {
    const baseJob = await executeJob(context, "base", "base", []);
    let jobs: JobResult[] = [baseJob];

    if (baseJob.classification === "BASE_PASS") {
      const branchAJob = await executeJob(context, "branch-a", "branch", [snapshot.branches[0]]);
      const branchBJob = await executeJob(context, "branch-b", "branch", [snapshot.branches[1]]);
      const mergeOrder = canonicalPair(snapshot.branches);
      const pairJob =
        branchAJob.classification === "BRANCH_PASS" && branchBJob.classification === "BRANCH_PASS"
          ? await executeJob(context, "pair-a-b", "pair", mergeOrder)
          : createSkippedPairJob(snapshot.base.sha, mergeOrder);
      jobs = [baseJob, branchAJob, branchBJob, pairJob];
    }

    const completedAtMs = Date.now();
    result = createRunResult({
      runId,
      toolVersion: options.toolVersion,
      snapshot,
      jobs,
      startedAt,
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
    });
  } finally {
    await worktrees.cleanupAll();
  }

  if (result === undefined) {
    throw new Error("The vertical-slice scan did not produce a result");
  }
  if (options.signal?.aborted === true) {
    const error = new Error("The vertical-slice scan was cancelled");
    error.name = "AbortError";
    throw error;
  }

  const resultPath = await writeValidatedResult(result, outputDirectory);
  return { result, resultPath, executionRoot };
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
        conflictedFiles: [...merge.conflictedFiles],
        commands: [],
        startedAt,
        startedAtMs,
      });
    }

    const execution = await context.commandRunner.run(
      context.command,
      worktreePath,
      context.signal,
    );
    const commandPassed = execution.result.status === "passed";

    if (kind === "base") {
      return createJobResult({
        id,
        kind,
        baseSha: context.snapshot.base.sha,
        branches,
        classification: commandPassed ? "BASE_PASS" : "INVALID_BASELINE",
        conflictedFiles: [],
        commands: [execution.result],
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
        classification: commandPassed
          ? "BRANCH_PASS"
          : classifyBranchCommandFailure(context.command.kind),
        conflictedFiles: [],
        commands: [execution.result],
        startedAt,
        startedAtMs,
      });
    }

    return createJobResult({
      id,
      kind,
      baseSha: context.snapshot.base.sha,
      branches,
      classification: commandPassed ? "NO_DETECTED_CONFLICT" : "BEHAVIORAL_CONFLICT",
      technicalClassification: commandPassed
        ? undefined
        : classifyPairCommandFailure(context.command.kind),
      conflictedFiles: [],
      commands: [execution.result],
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
  readonly technicalClassification?: JobResult["technicalClassification"] | undefined;
  readonly conflictedFiles: readonly string[];
  readonly commands: JobResult["commands"];
  readonly startedAt: string;
  readonly startedAtMs: number;
}

function createJobResult(options: CreateJobResultOptions): JobResult {
  const completedAtMs = Date.now();
  return JobResultSchema.parse({
    id: options.id,
    kind: options.kind,
    baseSha: options.baseSha,
    branchRefs: options.branches.map((branch) => branch.ref),
    branchShas: options.branches.map((branch) => branch.sha),
    mergeOrder: options.branches.map((branch) => branch.ref),
    classification: options.classification,
    ...(options.technicalClassification === undefined
      ? {}
      : { technicalClassification: options.technicalClassification }),
    conflictedFiles: [...options.conflictedFiles],
    commands: options.commands,
    startedAt: options.startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - options.startedAtMs),
  });
}

function createSkippedPairJob(
  baseSha: string,
  branches: readonly [BranchSnapshot, BranchSnapshot],
): JobResult {
  const now = new Date().toISOString();
  return JobResultSchema.parse({
    id: "pair-a-b",
    kind: "pair",
    baseSha,
    branchRefs: branches.map((branch) => branch.ref),
    branchShas: branches.map((branch) => branch.sha),
    mergeOrder: branches.map((branch) => branch.ref),
    classification: "PAIR_SKIPPED",
    conflictedFiles: [],
    commands: [],
    startedAt: now,
    completedAt: now,
    durationMs: 0,
  });
}

function canonicalPair(
  branches: readonly [BranchSnapshot, BranchSnapshot],
): readonly [BranchSnapshot, BranchSnapshot] {
  return branches[0].ref < branches[1].ref
    ? [branches[0], branches[1]]
    : [branches[1], branches[0]];
}

interface CreateRunResultOptions {
  readonly runId: string;
  readonly toolVersion: string;
  readonly snapshot: RepositorySnapshot;
  readonly jobs: readonly JobResult[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

function createRunResult(options: CreateRunResultOptions): RunResult {
  const baseJob = options.jobs.find((job) => job.kind === "base");
  const branchJobs = options.jobs.filter((job) => job.kind === "branch");
  const pairJob = options.jobs.find((job) => job.kind === "pair");
  const exitCode =
    baseJob?.classification !== "BASE_PASS"
      ? 3
      : branchJobs.some((job) => job.classification !== "BRANCH_PASS") ||
          pairJob?.classification !== "NO_DETECTED_CONFLICT"
        ? 1
        : 0;

  return RunResultSchema.parse({
    schemaVersion: 1,
    runId: options.runId,
    toolVersion: options.toolVersion,
    repositoryRoot: options.snapshot.repository.root,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    durationMs: options.durationMs,
    exitCode,
    base: options.snapshot.base,
    branches: [options.snapshot.branches[0], options.snapshot.branches[1]],
    jobs: options.jobs,
    summary: {
      branchCount: 2,
      pairCount: 1,
      passedBranches: branchJobs.filter((job) => job.classification === "BRANCH_PASS").length,
      passedPairs: pairJob?.classification === "NO_DETECTED_CONFLICT" ? 1 : 0,
      behavioralConflicts: pairJob?.classification === "BEHAVIORAL_CONFLICT" ? 1 : 0,
      textualConflicts: pairJob?.classification === "TEXTUAL_CONFLICT" ? 1 : 0,
      skippedPairs: pairJob?.classification === "PAIR_SKIPPED" ? 1 : 0,
    },
  });
}
