import { describe, expect, it } from "vitest";

import { createReportFixture } from "../helpers/reportFixture.js";
import {
  createTerminalProgressReporter,
  renderTerminalSummary,
} from "../../src/terminal/renderTerminal.js";

describe("terminal reporting", () => {
  it("renders base, branch, matrix, counts, classifications, and report locations as text", () => {
    const output = renderTerminalSummary(createReportFixture(), {
      resultPath: "/reports/result.json",
      htmlPath: "/reports/report.html",
      logsDirectory: "/reports/logs",
    });

    expect(output).toContain("Base passed [BASE_PASS]");
    expect(output).toContain("Branch passed [BRANCH_PASS]");
    expect(output).toContain("Compatibility matrix");
    expect(output).toContain("BC = Behavioral conflict");
    expect(output).toContain("No detected conflict");
    expect(output).toContain("Behavioral conflict [BEHAVIORAL_CONFLICT]");
    expect(output).toContain("Custom-command failure [PAIR_CUSTOM_FAILURE]");
    expect(output).toContain("Branches: 2 passed, 0 failed");
    expect(output).toContain("JSON: /reports/result.json");
    expect(output).toContain("HTML: /reports/report.html");
    expect(output).toContain("Raw logs: /reports/logs");
  });

  it("renders progress with explicit non-color status labels", () => {
    let output = "";
    const report = createTerminalProgressReporter((text) => {
      output += text;
    });
    report({
      type: "scan-started",
      repositoryFingerprint: "0123456789abcdef",
      baseRef: "main",
      branchRefs: ["feature/a", "feature/b"],
    });
    report({ type: "job-started", id: "base", kind: "base", branchRefs: [] });
    report({
      type: "job-completed",
      id: "base",
      kind: "base",
      branchRefs: [],
      classification: "BASE_PASS",
      durationMs: 10,
    });
    report({
      type: "report-published",
      resultPath: "/reports/result.json",
      htmlPath: "/reports/report.html",
      logsDirectory: "/reports/logs",
    });

    expect(output).toContain("SCAN");
    expect(output).toContain("RUN");
    expect(output).toContain("PASS");
    expect(output).toContain("Base passed [BASE_PASS]");
    expect(output).toContain("JSON and offline HTML reports published");
  });
});
