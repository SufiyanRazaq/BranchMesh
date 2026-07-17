import { createHash } from "node:crypto";
import path from "node:path";

import {
  RunResultSchema,
  type BoundedLog,
  type CommandResult,
  type RunResult,
} from "../model/results.js";
import { createRepositoryFingerprint } from "../utils/paths.js";
import { ReportProjectionSchema, type ReportProjection } from "./schema.js";

export interface ReportRedactionOptions {
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly additionalSensitiveValues?: readonly string[] | undefined;
}

export interface ReportRedactor {
  redact(value: string): string;
  sanitizeEvidence(value: string): string;
}

const sensitiveEnvironmentName = /(?:AUTH|COOKIE|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/iu;

export function createReportRedactor(
  result: RunResult,
  options: ReportRedactionOptions = {},
): ReportRedactor {
  const validatedResult = RunResultSchema.parse(result);
  const sensitiveValues = new Set<string>();

  for (const value of [
    validatedResult.repositoryRoot,
    validatedResult.commonGitDirectory,
    ...validatedResult.branches.map((branch) => branch.worktreePath),
    ...(options.additionalSensitiveValues ?? []),
  ]) {
    if (value !== null && value.length > 0) {
      sensitiveValues.add(value);
    }
  }

  for (const [name, value] of Object.entries(options.environment ?? process.env)) {
    if (
      value !== undefined &&
      value.length > 0 &&
      (value.length >= 8 || sensitiveEnvironmentName.test(name))
    ) {
      sensitiveValues.add(value);
    }
  }

  const orderedValues = [...sensitiveValues].sort((left, right) => right.length - left.length);
  const redact = (value: string): string => {
    let redacted = value;
    for (const sensitiveValue of orderedValues) {
      redacted = redacted.split(sensitiveValue).join("[redacted]");
    }
    return redacted;
  };

  return {
    redact,
    sanitizeEvidence: (value: string) => redact(stripAnsi(value)),
  };
}

export function createRedactedRunResult(
  result: RunResult,
  options: ReportRedactionOptions = {},
): RunResult {
  const validatedResult = RunResultSchema.parse(result);
  const redactor = createReportRedactor(validatedResult, options);
  return RunResultSchema.parse({
    ...validatedResult,
    repositoryRoot: "[redacted]",
    commonGitDirectory: "[redacted]",
    base: redactBranch(validatedResult.base, redactor),
    branches: validatedResult.branches.map((branch) => redactBranch(branch, redactor)),
    jobs: validatedResult.jobs.map((job) => ({
      ...job,
      conflictedFiles: job.conflictedFiles.map((file) => redactor.sanitizeEvidence(file)),
      commands: job.commands.map((command) => redactCommand(command, redactor)),
    })),
  });
}

export function createReportProjection(
  result: RunResult,
  options: ReportRedactionOptions = {},
): ReportProjection {
  const validatedResult = RunResultSchema.parse(result);
  const repositoryFingerprint = createRepositoryFingerprint(validatedResult.commonGitDirectory);
  const redactedResult = createRedactedRunResult(validatedResult, options);
  return ReportProjectionSchema.parse({
    schemaVersion: 1,
    runId: redactedResult.runId,
    toolVersion: redactedResult.toolVersion,
    repositoryFingerprint,
    runtime: redactedResult.runtime,
    startedAt: redactedResult.startedAt,
    completedAt: redactedResult.completedAt,
    durationMs: redactedResult.durationMs,
    exitCode: redactedResult.exitCode,
    base: reportBranch(redactedResult.base),
    branches: redactedResult.branches.map(reportBranch),
    jobs: redactedResult.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      baseSha: job.baseSha,
      branchRefs: job.branchRefs,
      branchShas: job.branchShas,
      mergeOrder: job.mergeOrder,
      classification: job.classification,
      technicalClassification: job.technicalClassification,
      skipReason: job.skipReason,
      failedCommandId: job.failedCommandId,
      conflictedFiles: job.conflictedFiles,
      commands: job.commands.map((command, commandIndex) => ({
        ...command,
        stdoutLogPath: commandLogRelativePath(job.id, commandIndex, command.id, "stdout"),
        stderrLogPath: commandLogRelativePath(job.id, commandIndex, command.id, "stderr"),
      })),
      reproduction: {
        baseSha: job.baseSha,
        mergeShas: job.branchShas,
        mergeOrder: job.mergeOrder,
        commands: job.commands.map((command) => command.command),
      },
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      durationMs: job.durationMs,
    })),
    summary: redactedResult.summary,
  });
}

export function commandLogRelativePath(
  jobId: string,
  commandIndex: number,
  commandId: string,
  stream: "stdout" | "stderr",
): string {
  const fileName = `${String(commandIndex).padStart(2, "0")}-${safeCommandLogId(commandId)}.${stream}.log`;
  return path.posix.join("logs", jobId, fileName);
}

export function safeCommandLogId(commandId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(commandId)) {
    throw new TypeError("Invalid report command ID");
  }
  if (commandId.length <= 64) {
    return commandId;
  }
  const digest = createHash("sha256").update(commandId).digest("hex").slice(0, 16);
  return `${commandId.slice(0, 48)}-${digest}`;
}

export function stripAnsi(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x9b) {
      index = skipControlSequence(value, index + 1);
      continue;
    }
    if (code !== 0x1b) {
      output += value[index] ?? "";
      continue;
    }

    const next = value.charCodeAt(index + 1);
    if (next === 0x5b) {
      index = skipControlSequence(value, index + 2);
    } else if (next === 0x5d) {
      index = skipOperatingSystemCommand(value, index + 2);
    } else if (!Number.isNaN(next)) {
      index += 1;
    }
  }
  return output;
}

function skipControlSequence(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return value.length - 1;
}

function skipOperatingSystemCommand(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x07) {
      return index;
    }
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
      return index + 1;
    }
  }
  return value.length - 1;
}

function redactCommand(command: CommandResult, redactor: ReportRedactor): CommandResult {
  return {
    ...command,
    label: redactor.sanitizeEvidence(command.label),
    command: redactor.sanitizeEvidence(command.command),
    stdout: redactBoundedLog(command.stdout, redactor),
    stderr: redactBoundedLog(command.stderr, redactor),
  };
}

function redactBranch(branch: RunResult["base"], redactor: ReportRedactor): RunResult["base"] {
  return {
    ...branch,
    changedFiles: branch.changedFiles.map((file) => redactor.sanitizeEvidence(file)),
    worktreePath: null,
  };
}

function redactBoundedLog(log: BoundedLog, redactor: ReportRedactor): BoundedLog {
  return { ...log, text: redactor.sanitizeEvidence(log.text) };
}

function reportBranch(branch: RunResult["base"]): {
  ref: string;
  sha: string;
  dirty: boolean;
  changedFiles: string[];
} {
  return {
    ref: branch.ref,
    sha: branch.sha,
    dirty: branch.dirty,
    changedFiles: [...branch.changedFiles],
  };
}
