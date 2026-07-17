import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RunResultSchema } from "../../src/model/results.js";
import { ReportProjectionSchema } from "../../src/report/schema.js";

const resultPath = "docs/samples/demo-result.json";
const reportPath = "docs/samples/demo-report.html";

describe("checked-in demo artifacts", () => {
  it("keeps the real demo result aligned with the strict result contract", async () => {
    const source = await readFile(resultPath, "utf8");
    const result = RunResultSchema.parse(JSON.parse(source));

    expect(result.repositoryRoot).toBe("[redacted]");
    expect(result.commonGitDirectory).toBe("[redacted]");
    expect(result.branches.every((branch) => branch.worktreePath === null)).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.jobs.filter((job) => job.kind === "branch")).toHaveLength(3);
    expect(
      result.jobs.filter((job) => job.kind === "branch").map((job) => job.classification),
    ).toEqual(["BRANCH_PASS", "BRANCH_PASS", "BRANCH_PASS"]);

    const pairs = result.jobs.filter((job) => job.kind === "pair");
    expect(pairs.map((job) => job.classification)).toEqual([
      "BEHAVIORAL_CONFLICT",
      "NO_DETECTED_CONFLICT",
      "NO_DETECTED_CONFLICT",
    ]);
    expect(pairs[0]?.technicalClassification).toBe("PAIR_TEST_FAILURE");
    expect(pairs[0]?.conflictedFiles).toEqual([]);
    expect(source).not.toMatch(/\/(?:Users|home|private)\//u);
    expect(source).not.toContain("\u001b");
  });

  it("keeps the sample HTML self-contained, redacted, and schema-valid", async () => {
    const result = RunResultSchema.parse(JSON.parse(await readFile(resultPath, "utf8")));
    const html = await readFile(reportPath, "utf8");
    const projection = ReportProjectionSchema.parse(extractEmbeddedProjection(html));

    expect(projection.runId).toBe(result.runId);
    expect(projection.exitCode).toBe(result.exitCode);
    expect(projection.summary).toEqual(result.summary);
    expect(projection.jobs.map((job) => job.classification)).toEqual(
      result.jobs.map((job) => job.classification),
    );
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("No detected conflict");
    expect(html).toContain("Behavioral conflict");
    expect(html).toContain("PAIR_TEST_FAILURE");
    expect(html).not.toContain("Guaranteed safe");
    expect(html).not.toMatch(/(?:src|href)=["']https?:/iu);
    expect(html).not.toContain("fetch(");
    expect(html).not.toMatch(/\/(?:Users|home|private)\//u);
    expect(html.match(/<\/script>/gu)).toHaveLength(2);
  });
});

function extractEmbeddedProjection(html: string): unknown {
  const match = html.match(
    /<script id="branchmesh-report-data" type="application\/json">(?<json>.*?)<\/script>/su,
  );
  if (match?.groups?.["json"] === undefined) {
    throw new Error("The sample report does not contain an embedded report projection");
  }
  return JSON.parse(match.groups["json"]);
}
