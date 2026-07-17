import { z } from "zod";

import { CommandKindSchema, type CommandKind } from "../config/schema.js";

const CommitIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const IsoTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

export const BaseClassificationSchema = z.enum(["BASE_PASS", "INVALID_BASELINE"]);
export const BranchClassificationSchema = z.enum([
  "BRANCH_PASS",
  "BASE_MERGE_CONFLICT",
  "BRANCH_TEST_FAILURE",
  "BRANCH_TYPECHECK_FAILURE",
  "BRANCH_LINT_FAILURE",
  "BRANCH_BUILD_FAILURE",
  "BRANCH_CUSTOM_FAILURE",
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
]);

export const PrimaryClassificationSchema = z.union([
  BaseClassificationSchema,
  BranchClassificationSchema,
  PairClassificationSchema,
]);

export const CommandResultSchema = z
  .strictObject({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: CommandKindSchema,
    command: z.string().min(1),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(["passed", "failed"]),
  })
  .superRefine((command, context) => {
    const processPassed = command.exitCode === 0 && command.signal === null;
    if ((command.status === "passed") !== processPassed) {
      context.addIssue({
        code: "custom",
        message: "Command status must agree with its exit code and signal",
        path: ["status"],
      });
    }
  });

export const BranchSnapshotSchema = z.strictObject({
  ref: z.string().min(1),
  sha: CommitIdSchema,
});

const baseClassifications: ReadonlySet<string> = new Set(BaseClassificationSchema.options);
const branchClassifications: ReadonlySet<string> = new Set(BranchClassificationSchema.options);
const pairClassifications: ReadonlySet<string> = new Set(PairClassificationSchema.options);
const passingClassifications: ReadonlySet<string> = new Set([
  "BASE_PASS",
  "BRANCH_PASS",
  "NO_DETECTED_CONFLICT",
]);
const classificationsWithoutCommands: ReadonlySet<string> = new Set([
  "BASE_MERGE_CONFLICT",
  "TEXTUAL_CONFLICT",
  "PAIR_SKIPPED",
]);
const technicalClassificationByKind: Record<CommandKind, TechnicalClassification> = {
  test: "PAIR_TEST_FAILURE",
  typecheck: "PAIR_TYPECHECK_FAILURE",
  lint: "PAIR_LINT_FAILURE",
  build: "PAIR_BUILD_FAILURE",
  custom: "PAIR_CUSTOM_FAILURE",
};

export const JobResultSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(["base", "branch", "pair"]),
    baseSha: CommitIdSchema,
    branchRefs: z.array(z.string().min(1)).max(2),
    branchShas: z.array(CommitIdSchema).max(2),
    mergeOrder: z.array(z.string().min(1)).max(2),
    classification: PrimaryClassificationSchema,
    technicalClassification: TechnicalClassificationSchema.optional(),
    conflictedFiles: z.array(z.string()),
    commands: z.array(CommandResultSchema).max(1),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .superRefine((job, context) => {
    const expectedBranches = job.kind === "base" ? 0 : job.kind === "branch" ? 1 : 2;

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
        message: "Merge order must match the ordered branch references",
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

    if (job.classification === "BEHAVIORAL_CONFLICT") {
      if (job.technicalClassification === undefined) {
        context.addIssue({
          code: "custom",
          message: "Behavioral conflicts require a technical classification",
          path: ["technicalClassification"],
        });
      } else if (
        job.commands[0] !== undefined &&
        job.technicalClassification !== technicalClassificationByKind[job.commands[0].kind]
      ) {
        context.addIssue({
          code: "custom",
          message: "Technical classification must match the failed command kind",
          path: ["technicalClassification"],
        });
      }
    } else if (job.technicalClassification !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only behavioral conflicts may have a technical classification",
        path: ["technicalClassification"],
      });
    }

    const expectedCommandCount = classificationsWithoutCommands.has(job.classification) ? 0 : 1;
    if (job.commands.length !== expectedCommandCount) {
      context.addIssue({
        code: "custom",
        message: `${job.classification} requires ${String(expectedCommandCount)} command results`,
        path: ["commands"],
      });
    }

    const command = job.commands[0];
    if (command !== undefined) {
      const expectedStatus = passingClassifications.has(job.classification) ? "passed" : "failed";
      if (command.status !== expectedStatus) {
        context.addIssue({
          code: "custom",
          message: `${job.classification} requires a ${expectedStatus} command result`,
          path: ["commands", 0, "status"],
        });
      }
    }

    const hasMergeConflict =
      job.classification === "BASE_MERGE_CONFLICT" || job.classification === "TEXTUAL_CONFLICT";
    if (hasMergeConflict !== job.conflictedFiles.length > 0) {
      context.addIssue({
        code: "custom",
        message: hasMergeConflict
          ? "Merge conflicts require at least one conflicted file"
          : "Only merge conflicts may include conflicted files",
        path: ["conflictedFiles"],
      });
    }
  });

export const RunResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    toolVersion: z.string().min(1),
    repositoryRoot: z.string().min(1),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(3)]),
    base: BranchSnapshotSchema,
    branches: z.tuple([BranchSnapshotSchema, BranchSnapshotSchema]),
    jobs: z.array(JobResultSchema).min(1).max(4),
    summary: z.strictObject({
      branchCount: z.literal(2),
      pairCount: z.literal(1),
      passedBranches: z.number().int().min(0).max(2),
      passedPairs: z.number().int().min(0).max(1),
      behavioralConflicts: z.number().int().min(0).max(1),
      textualConflicts: z.number().int().min(0).max(1),
      skippedPairs: z.number().int().min(0).max(1),
    }),
  })
  .superRefine((result, context) => {
    if (result.jobs[0]?.kind !== "base") {
      context.addIssue({
        code: "custom",
        message: "The first job must be the base job",
        path: ["jobs", 0],
      });
    }

    const ids = new Set(result.jobs.map((job) => job.id));
    if (ids.size !== result.jobs.length) {
      context.addIssue({
        code: "custom",
        message: "Job IDs must be unique",
        path: ["jobs"],
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
    const pairJob = result.jobs.find((job) => job.kind === "pair");
    const basePassed = baseJob?.classification === "BASE_PASS";
    if (basePassed && result.jobs.length !== 4) {
      context.addIssue({
        code: "custom",
        message: "A passing base requires two branch jobs and one pair job",
        path: ["jobs"],
      });
    }
    if (!basePassed && result.jobs.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "An invalid base must stop the scan before branch and pair jobs",
        path: ["jobs"],
      });
    }

    for (const [index, snapshot] of result.branches.entries()) {
      const branchJob = branchJobs[index];
      if (
        basePassed &&
        (branchJob?.branchRefs[0] !== snapshot.ref || branchJob.branchShas[0] !== snapshot.sha)
      ) {
        context.addIssue({
          code: "custom",
          message: "Branch jobs must match the ordered branch snapshots",
          path: ["jobs"],
        });
      }
    }

    if (pairJob !== undefined) {
      const expectedPair = [...result.branches].sort((left, right) =>
        left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0,
      );
      if (
        pairJob.branchRefs.some((reference, index) => reference !== expectedPair[index]?.ref) ||
        pairJob.branchShas.some((sha, index) => sha !== expectedPair[index]?.sha)
      ) {
        context.addIssue({
          code: "custom",
          message: "The pair job must use snapshots in deterministic branch-name order",
          path: ["jobs"],
        });
      }
    }

    const expectedExitCode = !basePassed
      ? 3
      : branchJobs.some((job) => job.classification !== "BRANCH_PASS") ||
          pairJob?.classification !== "NO_DETECTED_CONFLICT"
        ? 1
        : 0;
    if (result.exitCode !== expectedExitCode) {
      context.addIssue({
        code: "custom",
        message: "Run exit code does not match the observed classifications",
        path: ["exitCode"],
      });
    }

    const expectedSummary = {
      passedBranches: branchJobs.filter((job) => job.classification === "BRANCH_PASS").length,
      passedPairs: pairJob?.classification === "NO_DETECTED_CONFLICT" ? 1 : 0,
      behavioralConflicts: pairJob?.classification === "BEHAVIORAL_CONFLICT" ? 1 : 0,
      textualConflicts: pairJob?.classification === "TEXTUAL_CONFLICT" ? 1 : 0,
      skippedPairs: pairJob?.classification === "PAIR_SKIPPED" ? 1 : 0,
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

export type BaseClassification = z.infer<typeof BaseClassificationSchema>;
export type BranchClassification = z.infer<typeof BranchClassificationSchema>;
export type PairClassification = z.infer<typeof PairClassificationSchema>;
export type TechnicalClassification = z.infer<typeof TechnicalClassificationSchema>;
export type PrimaryClassification = z.infer<typeof PrimaryClassificationSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type BranchSnapshot = z.infer<typeof BranchSnapshotSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;
