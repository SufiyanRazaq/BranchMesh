import { z } from "zod";

import { CommandKindSchema, type CommandKind } from "../config/schema.js";

export const CommitIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const IsoTimestampSchema = z.string().datetime({ offset: false });

export const BaseClassificationSchema = z.enum([
  "BASE_PASS",
  "INVALID_BASELINE",
  "BASE_SETUP_FAILURE",
  "BASE_TIMEOUT",
]);
export const BranchClassificationSchema = z.enum([
  "BRANCH_PASS",
  "BASE_MERGE_CONFLICT",
  "BRANCH_TEST_FAILURE",
  "BRANCH_TYPECHECK_FAILURE",
  "BRANCH_LINT_FAILURE",
  "BRANCH_BUILD_FAILURE",
  "BRANCH_CUSTOM_FAILURE",
  "BRANCH_SETUP_FAILURE",
  "BRANCH_TIMEOUT",
]);
export const PairClassificationSchema = z.enum([
  "NO_DETECTED_CONFLICT",
  "TEXTUAL_CONFLICT",
  "BEHAVIORAL_CONFLICT",
  "PAIR_SKIPPED",
]);
export const TechnicalClassificationSchema = z.enum([
  "PAIR_TEST_FAILURE",
  "PAIR_TYPECHECK_FAILURE",
  "PAIR_LINT_FAILURE",
  "PAIR_BUILD_FAILURE",
  "PAIR_CUSTOM_FAILURE",
  "PAIR_SETUP_FAILURE",
  "PAIR_TIMEOUT",
]);

export const PrimaryClassificationSchema = z.union([
  BaseClassificationSchema,
  BranchClassificationSchema,
  PairClassificationSchema,
]);

export const BoundedLogSchema = z
  .strictObject({
    text: z.string().max(5_000_128),
    totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    capturedBytes: z.number().int().nonnegative().max(5_000_000),
    truncated: z.boolean(),
  })
  .superRefine((log, context) => {
    if (log.capturedBytes > log.totalBytes) {
      context.addIssue({
        code: "custom",
        message: "Captured bytes may not exceed total bytes",
        path: ["capturedBytes"],
      });
    }
    if (log.truncated !== log.capturedBytes < log.totalBytes) {
      context.addIssue({
        code: "custom",
        message: "Log truncation must agree with byte counts",
        path: ["truncated"],
      });
    }
  });

export const CommandResultSchema = z
  .strictObject({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: CommandKindSchema,
    command: z.string().min(1).max(16_384),
    timeoutMs: z.number().int().positive(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(["passed", "failed", "timed_out"]),
    timedOut: z.boolean(),
    stdout: BoundedLogSchema,
    stderr: BoundedLogSchema,
  })
  .superRefine((command, context) => {
    const processPassed = command.exitCode === 0 && command.signal === null && !command.timedOut;
    if ((command.status === "passed") !== processPassed) {
      context.addIssue({
        code: "custom",
        message: "Command status must agree with its exit code, signal, and timeout state",
        path: ["status"],
      });
    }
    if ((command.status === "timed_out") !== command.timedOut) {
      context.addIssue({
        code: "custom",
        message: "Timed-out status must agree with timedOut",
        path: ["timedOut"],
      });
    }
  });

export const BranchSnapshotSchema = z.strictObject({
  ref: z.string().min(1),
  fullRef: z.string().min(1).nullable(),
  sha: CommitIdSchema,
  changedFiles: z.array(z.string().min(1).max(4096)).max(1_000_000),
  dirty: z.boolean(),
  worktreePath: z.string().min(1).nullable(),
});

const baseClassifications: ReadonlySet<string> = new Set(BaseClassificationSchema.options);
const branchClassifications: ReadonlySet<string> = new Set(BranchClassificationSchema.options);
const pairClassifications: ReadonlySet<string> = new Set(PairClassificationSchema.options);
const passingClassifications: ReadonlySet<string> = new Set([
  "BASE_PASS",
  "BRANCH_PASS",
  "NO_DETECTED_CONFLICT",
]);
const mergeConflictClassifications: ReadonlySet<string> = new Set([
  "BASE_MERGE_CONFLICT",
  "TEXTUAL_CONFLICT",
]);

export const PairSkipReasonSchema = z.enum(["INDIVIDUAL_BRANCH_FAILED"]);

export const JobResultSchema = z
  .strictObject({
    id: z.string().regex(/^(?:base|branch-[0-4]|pair-[0-4]-[0-4])$/u),
    kind: z.enum(["base", "branch", "pair"]),
    baseSha: CommitIdSchema,
    branchRefs: z.array(z.string().min(1)).max(2),
    branchShas: z.array(CommitIdSchema).max(2),
    mergeOrder: z.array(z.string().min(1)).max(2),
    classification: PrimaryClassificationSchema,
    technicalClassification: TechnicalClassificationSchema.nullable(),
    skipReason: PairSkipReasonSchema.nullable(),
    failedCommandId: z.string().min(1).nullable(),
    conflictedFiles: z.array(z.string()),
    commands: z.array(CommandResultSchema).max(51),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .superRefine((job, context) => {
    const expectedBranches = job.kind === "base" ? 0 : job.kind === "branch" ? 1 : 2;
    const idMatchesKind =
      (job.kind === "base" && job.id === "base") ||
      (job.kind === "branch" && job.id.startsWith("branch-")) ||
      (job.kind === "pair" && job.id.startsWith("pair-"));
    if (!idMatchesKind) {
      context.addIssue({
        code: "custom",
        message: `Job ID ${job.id} does not match job kind ${job.kind}`,
        path: ["id"],
      });
    }

    for (const [field, values] of [
      ["branchRefs", job.branchRefs],
      ["branchShas", job.branchShas],
      ["mergeOrder", job.mergeOrder],
    ] as const) {
      if (values.length !== expectedBranches) {
        context.addIssue({
          code: "custom",
          message: `${job.kind} jobs require ${String(expectedBranches)} ${field}`,
          path: [field],
        });
      }
    }

    if (job.mergeOrder.some((reference, index) => reference !== job.branchRefs[index])) {
      context.addIssue({
        code: "custom",
        message: "Merge order must match the canonical branch-reference order",
        path: ["mergeOrder"],
      });
    }

    const classificationAllowed =
      (job.kind === "base" && baseClassifications.has(job.classification)) ||
      (job.kind === "branch" && branchClassifications.has(job.classification)) ||
      (job.kind === "pair" && pairClassifications.has(job.classification));
    if (!classificationAllowed) {
      context.addIssue({
        code: "custom",
        message: `Classification ${job.classification} is not valid for a ${job.kind} job`,
        path: ["classification"],
      });
    }

    const hasMergeConflict = mergeConflictClassifications.has(job.classification);
    if (hasMergeConflict !== job.conflictedFiles.length > 0) {
      context.addIssue({
        code: "custom",
        message: hasMergeConflict
          ? "Merge conflicts require at least one conflicted file"
          : "Only merge conflicts may include conflicted files",
        path: ["conflictedFiles"],
      });
    }

    const skipped = job.classification === "PAIR_SKIPPED";
    if (skipped !== (job.skipReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only skipped pairs require a skip reason",
        path: ["skipReason"],
      });
    }

    const lastCommand = job.commands.at(-1);
    const failedCommand = lastCommand?.status === "passed" ? undefined : lastCommand;
    if (job.failedCommandId !== (failedCommand?.id ?? null)) {
      context.addIssue({
        code: "custom",
        message: "failedCommandId must identify the terminal failed command",
        path: ["failedCommandId"],
      });
    }
    if (job.commands.slice(0, -1).some((command) => command.status !== "passed")) {
      context.addIssue({
        code: "custom",
        message: "Commands must stop immediately after the first failure",
        path: ["commands"],
      });
    }

    if (passingClassifications.has(job.classification)) {
      if (
        job.commands.length === 0 ||
        job.commands.some((command) => command.status !== "passed")
      ) {
        context.addIssue({
          code: "custom",
          message: `${job.classification} requires a passing command pipeline`,
          path: ["commands"],
        });
      }
    } else if (!hasMergeConflict && !skipped && failedCommand === undefined) {
      context.addIssue({
        code: "custom",
        message: `${job.classification} requires a failed command`,
        path: ["commands"],
      });
    }

    if ((hasMergeConflict || skipped) && job.commands.length !== 0) {
      context.addIssue({
        code: "custom",
        message: `${job.classification} may not include command results`,
        path: ["commands"],
      });
    }

    if (job.classification === "BEHAVIORAL_CONFLICT") {
      const expected =
        failedCommand === undefined ? undefined : pairTechnicalClassification(failedCommand);
      if (job.technicalClassification !== expected) {
        context.addIssue({
          code: "custom",
          message: "Pair technical classification must match its failed command",
          path: ["technicalClassification"],
        });
      }
    } else if (job.technicalClassification !== null) {
      context.addIssue({
        code: "custom",
        message: "Only behavioral conflicts may have a technical classification",
        path: ["technicalClassification"],
      });
    }

    if (job.kind === "branch" && failedCommand !== undefined) {
      const expected = branchFailureClassification(failedCommand);
      if (job.classification !== expected) {
        context.addIssue({
          code: "custom",
          message: "Branch classification must match its failed command",
          path: ["classification"],
        });
      }
    }

    if (job.kind === "base" && failedCommand !== undefined) {
      const expected = baseFailureClassification(failedCommand);
      if (job.classification !== expected) {
        context.addIssue({
          code: "custom",
          message: "Base classification must match its failed command",
          path: ["classification"],
        });
      }
    }
  });

export const RunResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    toolVersion: z.string().min(1),
    repositoryRoot: z.string().min(1),
    commonGitDirectory: z.string().min(1),
    runtime: z.strictObject({
      nodeVersion: z.string().min(1),
      gitVersion: z.string().min(1),
      platform: z.enum(["darwin", "linux"]),
      concurrency: z.number().int().min(1).max(2),
    }),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(3)]),
    base: BranchSnapshotSchema,
    branches: z.array(BranchSnapshotSchema).min(2).max(5),
    jobs: z.array(JobResultSchema).min(1).max(16),
    summary: z.strictObject({
      branchCount: z.number().int().min(2).max(5),
      pairCount: z.number().int().min(1).max(10),
      passedBranches: z.number().int().min(0).max(5),
      failedBranches: z.number().int().min(0).max(5),
      passedPairs: z.number().int().min(0).max(10),
      behavioralConflicts: z.number().int().min(0).max(10),
      textualConflicts: z.number().int().min(0).max(10),
      skippedPairs: z.number().int().min(0).max(10),
    }),
  })
  .superRefine((result, context) => {
    if (result.jobs[0]?.kind !== "base") {
      context.addIssue({
        code: "custom",
        message: "The first job must be the base job",
        path: ["jobs", 0],
      });
      return;
    }

    const ids = new Set(result.jobs.map((job) => job.id));
    if (ids.size !== result.jobs.length) {
      context.addIssue({ code: "custom", message: "Job IDs must be unique", path: ["jobs"] });
    }

    const sortedRefs = result.branches.map((branch) => branch.ref).sort(compareText);
    if (result.branches.some((branch, index) => branch.ref !== sortedRefs[index])) {
      context.addIssue({
        code: "custom",
        message: "Branch snapshots must use deterministic reference order",
        path: ["branches"],
      });
    }
    if (new Set(sortedRefs).size !== sortedRefs.length) {
      context.addIssue({
        code: "custom",
        message: "Branch snapshot references must be unique",
        path: ["branches"],
      });
    }

    for (const [index, job] of result.jobs.entries()) {
      if (job.baseSha !== result.base.sha) {
        context.addIssue({
          code: "custom",
          message: "Every job must use the snapshotted base commit",
          path: ["jobs", index, "baseSha"],
        });
      }
    }

    const baseJob = result.jobs[0];
    const branchJobs = result.jobs.filter((job) => job.kind === "branch");
    const pairJobs = result.jobs.filter((job) => job.kind === "pair");
    const expectedPairCount = (result.branches.length * (result.branches.length - 1)) / 2;
    const basePassed = baseJob.classification === "BASE_PASS";

    if (!basePassed && result.jobs.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "An invalid base must stop all downstream execution",
        path: ["jobs"],
      });
    }
    if (
      basePassed &&
      (branchJobs.length !== result.branches.length || pairJobs.length !== expectedPairCount)
    ) {
      context.addIssue({
        code: "custom",
        message: "A valid base requires every branch job and every planned pair result",
        path: ["jobs"],
      });
    }

    for (const [index, snapshot] of result.branches.entries()) {
      const job = branchJobs[index];
      if (
        basePassed &&
        (job?.id !== `branch-${String(index)}` ||
          job.branchRefs[0] !== snapshot.ref ||
          job.branchShas[0] !== snapshot.sha)
      ) {
        context.addIssue({
          code: "custom",
          message: "Branch jobs must match the ordered immutable snapshots",
          path: ["jobs"],
        });
      }
    }

    const expectedPairs = canonicalPairs(result.branches);
    for (const [index, pair] of expectedPairs.entries()) {
      const job = pairJobs[index];
      const [left, right] = pair;
      if (
        basePassed &&
        (job?.id !== `pair-${String(left.index)}-${String(right.index)}` ||
          job.branchRefs[0] !== left.snapshot.ref ||
          job.branchRefs[1] !== right.snapshot.ref ||
          job.branchShas[0] !== left.snapshot.sha ||
          job.branchShas[1] !== right.snapshot.sha)
      ) {
        context.addIssue({
          code: "custom",
          message: "Pair results must match canonical snapshot pairs",
          path: ["jobs"],
        });
      }

      if (job !== undefined) {
        const leftPassed = branchJobs[left.index]?.classification === "BRANCH_PASS";
        const rightPassed = branchJobs[right.index]?.classification === "BRANCH_PASS";
        const shouldSkip = !leftPassed || !rightPassed;
        if ((job.classification === "PAIR_SKIPPED") !== shouldSkip) {
          context.addIssue({
            code: "custom",
            message: "Pairs must be skipped exactly when an individual branch failed",
            path: ["jobs", result.jobs.indexOf(job), "classification"],
          });
        }
      }
    }

    if (basePassed) {
      const expectedJobIds = [
        "base",
        ...result.branches.map((_branch, index) => `branch-${String(index)}`),
        ...expectedPairs.map(
          ([left, right]) => `pair-${String(left.index)}-${String(right.index)}`,
        ),
      ];
      if (result.jobs.some((job, index) => job.id !== expectedJobIds[index])) {
        context.addIssue({
          code: "custom",
          message: "Stored jobs must retain deterministic plan order",
          path: ["jobs"],
        });
      }
    }

    const expectedExitCode = !basePassed
      ? 3
      : branchJobs.some((job) => job.classification !== "BRANCH_PASS") ||
          pairJobs.some((job) => job.classification !== "NO_DETECTED_CONFLICT")
        ? 1
        : 0;
    if (result.exitCode !== expectedExitCode) {
      context.addIssue({
        code: "custom",
        message: "Run exit code does not match the stable scan-result precedence",
        path: ["exitCode"],
      });
    }

    const expectedSummary = {
      branchCount: result.branches.length,
      pairCount: expectedPairCount,
      passedBranches: branchJobs.filter((job) => job.classification === "BRANCH_PASS").length,
      failedBranches: branchJobs.filter((job) => job.classification !== "BRANCH_PASS").length,
      passedPairs: pairJobs.filter((job) => job.classification === "NO_DETECTED_CONFLICT").length,
      behavioralConflicts: pairJobs.filter((job) => job.classification === "BEHAVIORAL_CONFLICT")
        .length,
      textualConflicts: pairJobs.filter((job) => job.classification === "TEXTUAL_CONFLICT").length,
      skippedPairs: pairJobs.filter((job) => job.classification === "PAIR_SKIPPED").length,
    };
    for (const [field, expected] of Object.entries(expectedSummary)) {
      if (result.summary[field as keyof typeof expectedSummary] !== expected) {
        context.addIssue({
          code: "custom",
          message: `Summary field ${field} does not match the jobs`,
          path: ["summary", field],
        });
      }
    }
  });

function pairTechnicalClassification(command: CommandResult): TechnicalClassification {
  if (command.status === "timed_out") {
    return "PAIR_TIMEOUT";
  }
  const byKind: Record<CommandKind, TechnicalClassification> = {
    setup: "PAIR_SETUP_FAILURE",
    test: "PAIR_TEST_FAILURE",
    typecheck: "PAIR_TYPECHECK_FAILURE",
    lint: "PAIR_LINT_FAILURE",
    build: "PAIR_BUILD_FAILURE",
    custom: "PAIR_CUSTOM_FAILURE",
  };
  return byKind[command.kind];
}

function branchFailureClassification(command: CommandResult): BranchClassification {
  if (command.status === "timed_out") {
    return "BRANCH_TIMEOUT";
  }
  const byKind: Record<CommandKind, BranchClassification> = {
    setup: "BRANCH_SETUP_FAILURE",
    test: "BRANCH_TEST_FAILURE",
    typecheck: "BRANCH_TYPECHECK_FAILURE",
    lint: "BRANCH_LINT_FAILURE",
    build: "BRANCH_BUILD_FAILURE",
    custom: "BRANCH_CUSTOM_FAILURE",
  };
  return byKind[command.kind];
}

function baseFailureClassification(command: CommandResult): BaseClassification {
  if (command.status === "timed_out") {
    return "BASE_TIMEOUT";
  }
  return command.kind === "setup" ? "BASE_SETUP_FAILURE" : "INVALID_BASELINE";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalPairs<T>(
  items: readonly T[],
): Array<readonly [{ index: number; snapshot: T }, { index: number; snapshot: T }]> {
  const pairs: Array<readonly [{ index: number; snapshot: T }, { index: number; snapshot: T }]> =
    [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const leftSnapshot = items[left];
      const rightSnapshot = items[right];
      if (leftSnapshot !== undefined && rightSnapshot !== undefined) {
        pairs.push([
          { index: left, snapshot: leftSnapshot },
          { index: right, snapshot: rightSnapshot },
        ]);
      }
    }
  }
  return pairs;
}

export type BaseClassification = z.infer<typeof BaseClassificationSchema>;
export type BranchClassification = z.infer<typeof BranchClassificationSchema>;
export type PairClassification = z.infer<typeof PairClassificationSchema>;
export type TechnicalClassification = z.infer<typeof TechnicalClassificationSchema>;
export type PrimaryClassification = z.infer<typeof PrimaryClassificationSchema>;
export type BoundedLog = z.infer<typeof BoundedLogSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type BranchSnapshot = z.infer<typeof BranchSnapshotSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;

export { baseFailureClassification, branchFailureClassification, pairTechnicalClassification };
