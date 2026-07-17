import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import type { JobResult, RunResult } from "../../src/model/results.js";
import { createRedactedRunResult } from "../../src/report/projection.js";
import { createReportFixture } from "../helpers/reportFixture.js";

const execFileAsync = promisify(execFile);
const skillRoot = path.resolve(".agents", "skills", "branchmesh");
const skillPath = path.join(skillRoot, "SKILL.md");
const metadataPath = path.join(skillRoot, "agents", "openai.yaml");
const runnerPath = path.join(skillRoot, "scripts", "run-branchmesh.mjs");

interface SkillModule {
  readonly assertDemoEvidence: (result: RunResult, evidence: Record<string, unknown>) => void;
  readonly assertNotInterrupted: (interruptionObserved?: boolean) => void;
  readonly createEnvelope: (
    result: RunResult,
    resultPath: string,
    scanExitCode: number | null,
    ephemeral?: boolean,
  ) => unknown;
  readonly missingResultOutcome: (scanExitCode: number) => number;
  readonly parseScanArguments: (arguments_: readonly string[]) => unknown;
}

let skillModule: SkillModule;

beforeAll(async () => {
  const imported: unknown = await import(pathToFileURL(runnerPath).href);
  if (!isSkillModule(imported)) throw new Error("The BranchMesh skill script exports changed");
  skillModule = imported;
});

describe("repository skill discovery", () => {
  it("has minimal trigger metadata and all required resources", async () => {
    const [skill, metadata, classifications, troubleshooting] = await Promise.all([
      readFile(skillPath, "utf8"),
      readFile(metadataPath, "utf8"),
      readFile(path.join(skillRoot, "references", "classifications.md"), "utf8"),
      readFile(path.join(skillRoot, "references", "troubleshooting.md"), "utf8"),
    ]);
    const frontmatter = /^---\n(?<content>[\s\S]*?)\n---/u.exec(skill)?.groups?.["content"];
    const frontmatterLines = frontmatter?.split("\n") ?? [];
    const name = frontmatterLines.find((line) => line.startsWith("name: "))?.slice("name: ".length);
    const description = frontmatterLines
      .find((line) => line.startsWith("description: "))
      ?.slice("description: ".length);

    expect(frontmatter).toBeDefined();
    expect(frontmatterLines.map((line) => line.split(":", 1)[0])).toEqual(["name", "description"]);
    expect(name).toBe("branchmesh");
    expect(name).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u);
    expect(name).not.toContain("--");
    expect(description?.length).toBeGreaterThan(0);
    expect(description?.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/u);
    expect(frontmatter).toContain("active worktrees");
    expect(frontmatter).toContain("branch compatibility");
    expect(skill).toContain("No detected conflict under the configured commands.");
    expect(skill).toContain("Never pass `--ignore-dirty`");
    expect(skill).toContain("Do not edit or fix project code unless");
    expect(skill).not.toContain("TODO");
    expect(metadata).toContain('display_name: "BranchMesh"');
    expect(metadata).toContain("$branchmesh");
    expect(classifications).toContain("BEHAVIORAL_CONFLICT");
    expect(troubleshooting).toContain("execution.ignoreDirty: true");
  });

  it("is valid JavaScript and keeps an argv-only local process boundary", async () => {
    const source = await readFile(runnerPath, "utf8");
    await execFileAsync(process.execPath, ["--check", runnerPath]);

    expect(source).toContain("spawn(command, arguments_");
    expect(source).toContain("shell: false");
    expect(source).toContain('dist", "cli.js');
    expect(source).toContain('dist", "contracts.js');
    expect(source).toContain('"--no-ignore-dirty"');
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/node:(?:http|https|net|dns)/u);
    expect(source).not.toMatch(/\b(?:curl|wget|npx)\b/u);
    expect(source).not.toContain("shell: true");
    expect(source).not.toContain('"merge"');
    expect(source).not.toContain('"worktree", "add"');
  });
});

describe("skill wrapper contract", () => {
  it("requires one explicit, bounded selection mode and preserves hostile refs as data", () => {
    expect(
      skillModule.parseScanArguments([
        "--repository",
        "/tmp/repository with spaces/é",
        "--base",
        "main",
        "--branch",
        "feature/$(touch-do-not-run)",
        "--branch",
        "feature/b",
      ]),
    ).toMatchObject({
      repository: "/tmp/repository with spaces/é",
      base: "main",
      branches: ["feature/$(touch-do-not-run)", "feature/b"],
      worktrees: false,
      configured: false,
    });

    expect(() => skillModule.parseScanArguments([])).toThrow(/exactly one/u);
    expect(() => skillModule.parseScanArguments(["--configured", "--worktrees"])).toThrow(
      /exactly one/u,
    );
    expect(() => skillModule.parseScanArguments(["--branch", "only-one"])).toThrow(/two to five/u);
    expect(() =>
      skillModule.parseScanArguments([
        "--branch",
        "a",
        "--branch",
        "b",
        "--branch",
        "c",
        "--branch",
        "d",
        "--branch",
        "e",
        "--branch",
        "f",
      ]),
    ).toThrow(/two to five/u);
    expect(() =>
      skillModule.parseScanArguments(["--branch", "feature/a", "--branch", "feature/a"]),
    ).toThrow(/unique/u);
    expect(() =>
      skillModule.parseScanArguments(["--branch", "feature/a,b", "--branch", "feature/c"]),
    ).toThrow(/commas/u);
    expect(() =>
      skillModule.parseScanArguments([
        "--base",
        "main",
        "--branch",
        "main",
        "--branch",
        "feature/a",
      ]),
    ).toThrow(/base reference/u);
    expect(() => skillModule.parseScanArguments(["--configured", "--ignore-dirty"])).toThrow(
      /never permits/u,
    );
  });

  it("emits bounded validated evidence with refs, SHAs, failed command, and report paths", () => {
    const result = createRedactedRunResult(createReportFixture(), { environment: {} });
    const resultPath = "/external/branchmesh/run/result.json";
    const envelope = skillModule.createEnvelope(result, resultPath, 1);

    expect(envelope).toMatchObject({
      validated: true,
      scanExitCode: 1,
      resultPath,
      htmlPath: "/external/branchmesh/run/report.html",
      base: { ref: "main", sha: "0".repeat(40), classification: "BASE_PASS" },
      branches: [
        { ref: "feature/alpha", sha: "a".repeat(40), classification: "BRANCH_PASS" },
        { ref: "feature/beta", sha: "b".repeat(40), classification: "BRANCH_PASS" },
      ],
      pairs: [
        {
          refs: ["feature/alpha", "feature/beta"],
          shas: ["a".repeat(40), "b".repeat(40)],
          classification: "BEHAVIORAL_CONFLICT",
          technicalClassification: "PAIR_CUSTOM_FAILURE",
          failedCommand: { id: "verify", kind: "custom", exitCode: 1 },
        },
      ],
    });
    expect(envelope).toMatchObject({
      reportRetained: true,
      pairs: [{ failedCommand: { evidence: { stdout: "verification output\n", stderr: "" } } }],
    });
  });

  it("fails closed when a completed scan has no exact published result", () => {
    expect(() => skillModule.missingResultOutcome(0)).toThrow(/result\.json.*missing/iu);
    expect(() => skillModule.missingResultOutcome(1)).toThrow(/result\.json.*missing/iu);
    expect(() => skillModule.missingResultOutcome(3)).toThrow(/result\.json.*missing/iu);
  });

  it("turns wrapper-phase cancellation into an explicit interruption", () => {
    expect(() => skillModule.assertNotInterrupted(false)).not.toThrow();
    expect(() => skillModule.assertNotInterrupted(true)).toThrow(/interrupted/iu);
  });

  it("rejects deterministic-demo evidence for the wrong hidden-conflict pair", () => {
    const result = createThreeBranchDemoLikeResult();
    const wrongPair = result.jobs.find(
      (job) =>
        job.kind === "pair" &&
        job.branchRefs.includes("feature/status-output") &&
        job.classification === "NO_DETECTED_CONFLICT",
    );
    if (wrongPair === undefined) throw new Error("The test fixture has no alternate pair");
    const actualConflict = result.jobs.find(
      (job) => job.kind === "pair" && job.classification === "BEHAVIORAL_CONFLICT",
    );
    if (actualConflict === undefined) throw new Error("The test fixture has no conflict pair");
    const jobs = result.jobs.map((job) => {
      if (job.id === actualConflict.id) {
        return {
          ...job,
          classification: "NO_DETECTED_CONFLICT" as const,
          technicalClassification: null,
          failedCommandId: null,
        };
      }
      if (job.id === wrongPair.id) {
        return {
          ...job,
          classification: "BEHAVIORAL_CONFLICT" as const,
          technicalClassification: "PAIR_TEST_FAILURE" as const,
          failedCommandId: "test",
          commands: job.commands.map((command) => ({
            ...command,
            id: "test",
            kind: "test" as const,
            command: "node --test",
            status: "failed" as const,
            exitCode: 1,
          })),
        };
      }
      return job;
    });

    expect(() =>
      skillModule.assertDemoEvidence(
        { ...result, jobs },
        { repositoryUnchanged: true, temporaryWorktreesRemaining: 0 },
      ),
    ).toThrow(/hidden conflict/iu);
  });

  it("does not advertise deleted demo paths and carries bounded redacted evidence", () => {
    const result = createRedactedRunResult(createReportFixture(), { environment: {} });
    const envelope = skillModule.createEnvelope(
      result,
      "/temporary/branchmesh-skill/report/result.json",
      1,
      true,
    );

    expect(envelope).toMatchObject({
      ephemeral: true,
      reportRetained: false,
      resultPath: null,
      htmlPath: null,
      logsDirectory: null,
      pairs: [
        {
          failedCommand: {
            evidence: {
              stdout: "verification output\n",
              stderr: "",
            },
          },
        },
      ],
    });
    expect(JSON.stringify(envelope).length).toBeLessThan(16_384);
  });
});

function isSkillModule(value: unknown): value is SkillModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "assertDemoEvidence" in value &&
    typeof value.assertDemoEvidence === "function" &&
    "assertNotInterrupted" in value &&
    typeof value.assertNotInterrupted === "function" &&
    "createEnvelope" in value &&
    typeof value.createEnvelope === "function" &&
    "missingResultOutcome" in value &&
    typeof value.missingResultOutcome === "function" &&
    "parseScanArguments" in value &&
    typeof value.parseScanArguments === "function"
  );
}

function createThreeBranchDemoLikeResult(): RunResult {
  const base = createRedactedRunResult(createReportFixture(), { environment: {} });
  const thirdSha = "c".repeat(40);
  const third = {
    ref: "feature/status-output",
    fullRef: "refs/heads/feature/status-output",
    sha: thirdSha,
    changedFiles: ["src/status.js"],
    dirty: false,
    worktreePath: null,
  };
  const templateBranch = base.jobs.find((job) => job.kind === "branch");
  const templatePair = base.jobs.find((job) => job.kind === "pair");
  const firstBranch = base.branches[0];
  const secondBranch = base.branches[1];
  if (
    templateBranch === undefined ||
    templatePair === undefined ||
    firstBranch === undefined ||
    secondBranch === undefined
  ) {
    throw new Error("The report fixture is incomplete");
  }
  const branches: RunResult["branches"] = [
    { ...firstBranch, ref: "feature/config-seconds" },
    { ...secondBranch, ref: "feature/jitter" },
    third,
  ];
  const branchJobs: JobResult[] = branches.map((branch, index) => ({
    ...templateBranch,
    id: `branch-${String(index)}`,
    branchRefs: [branch.ref],
    branchShas: [branch.sha],
    mergeOrder: [branch.ref],
  }));
  const pair = (left: number, right: number, conflict: boolean): JobResult => {
    const leftBranch = branches[left];
    const rightBranch = branches[right];
    if (leftBranch === undefined || rightBranch === undefined) {
      throw new Error("The demo-like pair index is invalid");
    }
    return {
      ...templatePair,
      id: `pair-${String(left)}-${String(right)}`,
      branchRefs: [leftBranch.ref, rightBranch.ref],
      branchShas: [leftBranch.sha, rightBranch.sha],
      mergeOrder: [leftBranch.ref, rightBranch.ref],
      classification: conflict ? "BEHAVIORAL_CONFLICT" : "NO_DETECTED_CONFLICT",
      technicalClassification: conflict ? "PAIR_TEST_FAILURE" : null,
      failedCommandId: conflict ? "test" : null,
      commands: templatePair.commands.map((command) => ({
        ...command,
        id: "test",
        kind: "test",
        command: "node --test",
        status: conflict ? "failed" : "passed",
        exitCode: conflict ? 1 : 0,
      })),
    };
  };

  return {
    ...base,
    branches,
    jobs: [base.jobs[0]!, ...branchJobs, pair(0, 1, true), pair(0, 2, false), pair(1, 2, false)],
    summary: {
      ...base.summary,
      branchCount: 3,
      pairCount: 3,
      passedBranches: 3,
      passedPairs: 2,
    },
  };
}
