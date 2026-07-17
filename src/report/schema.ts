import { z } from "zod";

import { CommandKindSchema } from "../config/schema.js";
import {
  BaseClassificationSchema,
  BoundedLogSchema,
  BranchClassificationSchema,
  CommitIdSchema,
  PairClassificationSchema,
  PairSkipReasonSchema,
  PrimaryClassificationSchema,
  TechnicalClassificationSchema,
} from "../model/results.js";

const IsoTimestampSchema = z.string().datetime({ offset: false });
const RelativeLogPathSchema = z
  .string()
  .regex(
    /^logs\/(?:base|branch-[0-4]|pair-[0-4]-[0-4])\/[0-9]{2}-[A-Za-z0-9._-]+\.(?:stdout|stderr)\.log$/u,
  );

export const ReportBranchSchema = z.strictObject({
  ref: z.string().min(1).max(1024),
  sha: CommitIdSchema,
  dirty: z.boolean(),
  changedFiles: z.array(z.string().min(1).max(4096)).max(1_000_000),
});

export const ReportCommandSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  label: z.string().min(1).max(256),
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
  stdoutLogPath: RelativeLogPathSchema,
  stderrLogPath: RelativeLogPathSchema,
});

export const ReportJobSchema = z
  .strictObject({
    id: z.string().regex(/^(?:base|branch-[0-4]|pair-[0-4]-[0-4])$/u),
    kind: z.enum(["base", "branch", "pair"]),
    baseSha: CommitIdSchema,
    branchRefs: z.array(z.string().min(1).max(1024)).max(2),
    branchShas: z.array(CommitIdSchema).max(2),
    mergeOrder: z.array(z.string().min(1).max(1024)).max(2),
    classification: PrimaryClassificationSchema,
    technicalClassification: TechnicalClassificationSchema.nullable(),
    skipReason: PairSkipReasonSchema.nullable(),
    failedCommandId: z.string().min(1).nullable(),
    conflictedFiles: z.array(z.string().min(1).max(4096)),
    commands: z.array(ReportCommandSchema).max(51),
    reproduction: z.strictObject({
      baseSha: CommitIdSchema,
      mergeShas: z.array(CommitIdSchema).max(2),
      mergeOrder: z.array(z.string().min(1).max(1024)).max(2),
      commands: z.array(z.string().min(1).max(16_384)).max(51),
    }),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .superRefine((job, context) => {
    const classificationAllowed =
      (job.kind === "base" && BaseClassificationSchema.safeParse(job.classification).success) ||
      (job.kind === "branch" && BranchClassificationSchema.safeParse(job.classification).success) ||
      (job.kind === "pair" && PairClassificationSchema.safeParse(job.classification).success);
    if (!classificationAllowed) {
      context.addIssue({
        code: "custom",
        message: `Classification ${job.classification} is not valid for ${job.kind}`,
        path: ["classification"],
      });
    }
  });

export const ReportProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(256),
  toolVersion: z.string().min(1).max(256),
  repositoryFingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
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
  base: ReportBranchSchema,
  branches: z.array(ReportBranchSchema).min(2).max(5),
  jobs: z.array(ReportJobSchema).min(1).max(16),
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
});

export type ReportBranch = z.infer<typeof ReportBranchSchema>;
export type ReportCommand = z.infer<typeof ReportCommandSchema>;
export type ReportJob = z.infer<typeof ReportJobSchema>;
export type ReportProjection = z.infer<typeof ReportProjectionSchema>;
