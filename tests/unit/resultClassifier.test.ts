import { describe, expect, it } from "vitest";

import type { CommandKind } from "../../src/config/schema.js";
import {
  classifyBaseCommandFailure,
  classifyBranchCommandFailure,
  classifyPairCommandFailure,
} from "../../src/engine/ResultClassifier.js";
import type { CommandResult } from "../../src/model/results.js";

describe("stable command-failure classification", () => {
  it("maps every command kind to its base, branch, and pair taxonomy", () => {
    const expected = {
      setup: ["BASE_SETUP_FAILURE", "BRANCH_SETUP_FAILURE", "PAIR_SETUP_FAILURE"],
      test: ["INVALID_BASELINE", "BRANCH_TEST_FAILURE", "PAIR_TEST_FAILURE"],
      typecheck: ["INVALID_BASELINE", "BRANCH_TYPECHECK_FAILURE", "PAIR_TYPECHECK_FAILURE"],
      lint: ["INVALID_BASELINE", "BRANCH_LINT_FAILURE", "PAIR_LINT_FAILURE"],
      build: ["INVALID_BASELINE", "BRANCH_BUILD_FAILURE", "PAIR_BUILD_FAILURE"],
      custom: ["INVALID_BASELINE", "BRANCH_CUSTOM_FAILURE", "PAIR_CUSTOM_FAILURE"],
    } as const;

    for (const [kind, classifications] of Object.entries(expected)) {
      const command = failedCommand(kind as CommandKind);
      expect([
        classifyBaseCommandFailure(command),
        classifyBranchCommandFailure(command),
        classifyPairCommandFailure(command),
      ]).toEqual(classifications);
    }
  });

  it("gives timeout precedence over the command kind", () => {
    const command = failedCommand("setup", "timed_out");
    expect(classifyBaseCommandFailure(command)).toBe("BASE_TIMEOUT");
    expect(classifyBranchCommandFailure(command)).toBe("BRANCH_TIMEOUT");
    expect(classifyPairCommandFailure(command)).toBe("PAIR_TIMEOUT");
  });
});

function failedCommand(
  kind: CommandKind,
  status: CommandResult["status"] = "failed",
): CommandResult {
  return {
    id: "command",
    label: "Command",
    kind,
    command: "exit 1",
    timeoutMs: 1000,
    exitCode: status === "timed_out" ? null : 1,
    signal: status === "timed_out" ? "SIGTERM" : null,
    durationMs: 1,
    status,
    timedOut: status === "timed_out",
    stdout: { text: "", totalBytes: 0, capturedBytes: 0, truncated: false },
    stderr: { text: "", totalBytes: 0, capturedBytes: 0, truncated: false },
  };
}
