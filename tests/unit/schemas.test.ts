import { describe, expect, it } from "vitest";

import { VerticalSliceConfigSchema } from "../../src/config/schema.js";
import { JobResultSchema } from "../../src/model/results.js";

const validConfig = {
  base: "main",
  branches: ["feature/a", "feature/b"],
  commands: [
    {
      id: "test",
      label: "Tests",
      kind: "test",
      command: "node --test",
    },
  ],
} as const;

describe("vertical-slice configuration contract", () => {
  it("accepts exactly two distinct branches and one command", () => {
    expect(VerticalSliceConfigSchema.parse(validConfig)).toEqual(validConfig);
  });

  it("rejects unknown fields and unsafe Git option-like refs", () => {
    expect(() => VerticalSliceConfigSchema.parse({ ...validConfig, unexpected: true })).toThrow();
    expect(() =>
      VerticalSliceConfigSchema.parse({
        ...validConfig,
        branches: ["feature/a", "--upload-pack=unsafe"],
      }),
    ).toThrow();
  });
});

describe("vertical-slice result contract", () => {
  const behavioralConflict = {
    id: "pair-a-b",
    kind: "pair",
    baseSha: "a".repeat(40),
    branchRefs: ["feature/a", "feature/b"],
    branchShas: ["b".repeat(40), "c".repeat(40)],
    mergeOrder: ["feature/a", "feature/b"],
    classification: "BEHAVIORAL_CONFLICT",
    conflictedFiles: [],
    commands: [
      {
        id: "test",
        label: "Tests",
        kind: "test",
        command: "node --test",
        exitCode: 1,
        signal: null,
        durationMs: 10,
        status: "failed",
      },
    ],
    startedAt: "2026-07-17T09:00:00.000Z",
    completedAt: "2026-07-17T09:00:00.010Z",
    durationMs: 10,
  } as const;

  it("requires a technical classification for a behavioral conflict", () => {
    expect(() => JobResultSchema.parse(behavioralConflict)).toThrow();
    expect(
      JobResultSchema.parse({
        ...behavioralConflict,
        technicalClassification: "PAIR_TEST_FAILURE",
      }).technicalClassification,
    ).toBe("PAIR_TEST_FAILURE");
  });

  it("forbids a technical classification on a passing pair", () => {
    expect(() =>
      JobResultSchema.parse({
        ...behavioralConflict,
        classification: "NO_DETECTED_CONFLICT",
        technicalClassification: "PAIR_TEST_FAILURE",
      }),
    ).toThrow();
  });
});
