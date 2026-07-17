import {
  RunResultSchema,
  type BoundedLog,
  type CommandResult,
  type JobResult,
  type RunResult,
} from "../../src/model/results.js";

export interface ReportFixtureOptions {
  readonly branchRefs?: readonly [string, string] | undefined;
  readonly command?: string | undefined;
  readonly commandLabel?: string | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
}

const timestamp = "2026-07-17T10:00:00.000Z";
const baseSha = "0".repeat(40);
const leftSha = "a".repeat(40);
const rightSha = "b".repeat(40);

export function createReportFixture(options: ReportFixtureOptions = {}): RunResult {
  const branchRefs = options.branchRefs ?? ["feature/alpha", "feature/beta"];
  const command = options.command ?? 'node -e "process.exit(0)"';
  const commandLabel = options.commandLabel ?? "Verification";
  const stdout = options.stdout ?? "verification output\n";
  const stderr = options.stderr ?? "";
  const branches = [
    {
      ref: branchRefs[0],
      fullRef: `refs/heads/${branchRefs[0]}`,
      sha: leftSha,
      changedFiles: ["src/alpha.ts"],
      dirty: false,
      worktreePath: "/private/user-worktrees/alpha",
    },
    {
      ref: branchRefs[1],
      fullRef: `refs/heads/${branchRefs[1]}`,
      sha: rightSha,
      changedFiles: ["src/beta.ts"],
      dirty: false,
      worktreePath: null,
    },
  ] as const;
  const passingCommand = commandResult({
    command,
    label: commandLabel,
    exitCode: 0,
    status: "passed",
    stdout,
    stderr,
  });
  const failedCommand = commandResult({
    command,
    label: commandLabel,
    exitCode: 1,
    status: "failed",
    stdout,
    stderr,
  });
  const jobs: JobResult[] = [
    job({ id: "base", kind: "base", classification: "BASE_PASS", commands: [passingCommand] }),
    job({
      id: "branch-0",
      kind: "branch",
      branches: [branches[0]],
      classification: "BRANCH_PASS",
      commands: [passingCommand],
    }),
    job({
      id: "branch-1",
      kind: "branch",
      branches: [branches[1]],
      classification: "BRANCH_PASS",
      commands: [passingCommand],
    }),
    job({
      id: "pair-0-1",
      kind: "pair",
      branches,
      classification: "BEHAVIORAL_CONFLICT",
      technicalClassification: "PAIR_CUSTOM_FAILURE",
      commands: [failedCommand],
    }),
  ];

  return RunResultSchema.parse({
    schemaVersion: 1,
    runId: "20260717T100000-fixture",
    toolVersion: "test",
    repositoryRoot: "/private/repositories/example",
    commonGitDirectory: "/private/repositories/example/.git",
    runtime: {
      nodeVersion: "v20.19.0",
      gitVersion: "2.50.0",
      platform: "darwin",
      concurrency: 1,
    },
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 125,
    exitCode: 1,
    base: {
      ref: "main",
      fullRef: "refs/heads/main",
      sha: baseSha,
      changedFiles: [],
      dirty: false,
      worktreePath: null,
    },
    branches,
    jobs,
    summary: {
      branchCount: 2,
      pairCount: 1,
      passedBranches: 2,
      failedBranches: 0,
      passedPairs: 0,
      behavioralConflicts: 1,
      textualConflicts: 0,
      skippedPairs: 0,
    },
  });
}

interface CommandOptions {
  readonly command: string;
  readonly label: string;
  readonly exitCode: 0 | 1;
  readonly status: "passed" | "failed";
  readonly stdout: string;
  readonly stderr: string;
}

function commandResult(options: CommandOptions): CommandResult {
  return {
    id: "verify",
    label: options.label,
    kind: "custom",
    command: options.command,
    timeoutMs: 5_000,
    exitCode: options.exitCode,
    signal: null,
    durationMs: 25,
    status: options.status,
    timedOut: false,
    stdout: boundedLog(options.stdout),
    stderr: boundedLog(options.stderr),
  };
}

interface JobOptions {
  readonly id: string;
  readonly kind: "base" | "branch" | "pair";
  readonly branches?: readonly {
    readonly ref: string;
    readonly sha: string;
  }[];
  readonly classification: JobResult["classification"];
  readonly technicalClassification?: JobResult["technicalClassification"];
  readonly commands: readonly CommandResult[];
}

function job(options: JobOptions): JobResult {
  const branches = options.branches ?? [];
  const failedCommand = options.commands.at(-1)?.status === "passed" ? null : "verify";
  return {
    id: options.id,
    kind: options.kind,
    baseSha,
    branchRefs: branches.map((branch) => branch.ref),
    branchShas: branches.map((branch) => branch.sha),
    mergeOrder: branches.map((branch) => branch.ref),
    classification: options.classification,
    technicalClassification: options.technicalClassification ?? null,
    skipReason: null,
    failedCommandId: failedCommand,
    conflictedFiles: [],
    commands: [...options.commands],
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 25,
  };
}

function boundedLog(text: string): BoundedLog {
  const bytes = Buffer.byteLength(text);
  return { text, totalBytes: bytes, capturedBytes: bytes, truncated: false };
}
