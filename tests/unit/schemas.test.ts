import { describe, expect, it } from "vitest";

import { ScanConfigSchema } from "../../src/config/schema.js";
import { JobResultSchema } from "../../src/model/results.js";

const validConfig = {
  base: "main",
  branches: ["feature/c", "feature/a", "feature/b"],
  commands: [
    {
      id: "test",
      label: "Tests",
      kind: "test",
      command: "node --test",
    },
  ],
} as const;

describe("scan configuration contract", () => {
  it("applies deterministic safe defaults to the strict contract", () => {
    const parsed = ScanConfigSchema.parse(validConfig);

    expect(parsed.commands[0]?.timeoutMs).toBe(120_000);
    expect(parsed.execution).toEqual({
      maxBranches: 5,
      concurrency: 2,
      failFast: false,
      skipPairsWithFailedBranches: true,
      ignoreDirty: false,
      maximumLogBytes: 200_000,
    });
  });

  it("accepts worktree selection and an optional setup command", () => {
    const parsed = ScanConfigSchema.parse({
      ...validConfig,
      branches: { source: "worktrees", include: ["feature/*"], exclude: ["feature/wip-*"] },
      setup: { command: "npm install --ignore-scripts" },
    });

    expect(parsed.setup?.timeoutMs).toBe(300_000);
  });

  it("rejects unknown fields, duplicate IDs, unsafe refs, and more than five branches", () => {
    expect(() => ScanConfigSchema.parse({ ...validConfig, unexpected: true })).toThrow();
    expect(() =>
      ScanConfigSchema.parse({ ...validConfig, branches: ["feature/a", "--upload-pack=unsafe"] }),
    ).toThrow();
    expect(() =>
      ScanConfigSchema.parse({
        ...validConfig,
        branches: ["a", "b", "c", "d", "e", "f"],
      }),
    ).toThrow();
    expect(() =>
      ScanConfigSchema.parse({
        ...validConfig,
        commands: [validConfig.commands[0], validConfig.commands[0]],
      }),
    ).toThrow();
  });
});

describe("scan result job contract", () => {
  const behavioralConflict = {
    id: "pair-0-1",
    kind: "pair",
    baseSha: "a".repeat(40),
    branchRefs: ["feature/a", "feature/b"],
    branchShas: ["b".repeat(40), "c".repeat(40)],
    mergeOrder: ["feature/a", "feature/b"],
    classification: "BEHAVIORAL_CONFLICT",
    technicalClassification: "PAIR_TEST_FAILURE",
    skipReason: null,
    failedCommandId: "test",
    conflictedFiles: [],
    commands: [
      {
        id: "test",
        label: "Tests",
        kind: "test",
        command: "node --test",
        timeoutMs: 120_000,
        exitCode: 1,
        signal: null,
        durationMs: 10,
        status: "failed",
        timedOut: false,
        stdout: { text: "", totalBytes: 0, capturedBytes: 0, truncated: false },
        stderr: { text: "failure", totalBytes: 7, capturedBytes: 7, truncated: false },
      },
    ],
    startedAt: "2026-07-17T09:00:00.000Z",
    completedAt: "2026-07-17T09:00:00.010Z",
    durationMs: 10,
  } as const;

  it("requires behavioral pair failures to carry the matching technical classification", () => {
    expect(JobResultSchema.parse(behavioralConflict).technicalClassification).toBe(
      "PAIR_TEST_FAILURE",
    );
    expect(() =>
      JobResultSchema.parse({ ...behavioralConflict, technicalClassification: null }),
    ).toThrow();
    expect(() =>
      JobResultSchema.parse({
        ...behavioralConflict,
        technicalClassification: "PAIR_BUILD_FAILURE",
      }),
    ).toThrow();
  });

  it("requires skipped pairs to have no commands and an explicit reason", () => {
    expect(
      JobResultSchema.parse({
        ...behavioralConflict,
        classification: "PAIR_SKIPPED",
        technicalClassification: null,
        skipReason: "INDIVIDUAL_BRANCH_FAILED",
        failedCommandId: null,
        commands: [],
      }).classification,
    ).toBe("PAIR_SKIPPED");
  });
});
