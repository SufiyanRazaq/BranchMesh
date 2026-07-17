import { describe, expect, it } from "vitest";

import { createReportFixture } from "../helpers/reportFixture.js";
import { RunResultSchema } from "../../src/model/results.js";
import {
  commandLogRelativePath,
  createRedactedRunResult,
  createReportProjection,
  stripAnsi,
} from "../../src/report/projection.js";
import { ReportProjectionSchema } from "../../src/report/schema.js";
import { createRepositoryFingerprint } from "../../src/utils/paths.js";

describe("report projection", () => {
  it("validates a path-free projection and redacts environment values and ANSI evidence", () => {
    const secret = "m4-sensitive-token";
    const result = createReportFixture({
      command: `node -e "console.log('${secret}')"`,
      commandLabel: `Verify ${secret}`,
      stdout: `\u001b[31m${secret}\u001b[0m /private/repositories/example\n`,
      stderr: "/private/user-worktrees/alpha\n",
    });
    const environment = { BRANCHMESH_TEST_SECRET: secret };
    const projection = createReportProjection(result, { environment });
    const serialized = JSON.stringify(projection);

    expect(ReportProjectionSchema.parse(projection)).toEqual(projection);
    expect(projection.repositoryFingerprint).toBe(
      createRepositoryFingerprint(result.commonGitDirectory),
    );
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(result.repositoryRoot);
    expect(serialized).not.toContain(result.commonGitDirectory);
    expect(serialized).not.toContain("/private/user-worktrees/alpha");
    expect(serialized).not.toContain("\u001b");
    expect(serialized).not.toContain("repositoryRoot");
    expect(serialized).not.toContain("commonGitDirectory");
    expect(serialized).not.toContain("worktreePath");
    expect(projection.jobs[0]?.commands[0]?.stdoutLogPath).toBe("logs/base/00-verify.stdout.log");
  });

  it("publishes a validated JSON result with local roots and selected worktree paths removed", () => {
    const result = createReportFixture();
    const redacted = createRedactedRunResult(result, { environment: {} });

    expect(RunResultSchema.parse(redacted)).toEqual(redacted);
    expect(redacted.repositoryRoot).toBe("[redacted]");
    expect(redacted.commonGitDirectory).toBe("[redacted]");
    expect(redacted.branches.every((branch) => branch.worktreePath === null)).toBe(true);
  });

  it("strips CSI, OSC, and single-character ANSI escape sequences", () => {
    const value = "before\u001b[31mred\u001b[0m\u001b]0;title\u0007after\u001b7done";
    expect(stripAnsi(value)).toBe("beforeredafterdone");
  });

  it("keeps log filenames bounded for valid long command IDs", () => {
    const relativePath = commandLogRelativePath(
      "base",
      0,
      `command-${"a".repeat(1_000)}`,
      "stdout",
    );
    expect(relativePath).toMatch(/^logs\/base\/00-command-/u);
    expect(relativePath.split("/").at(-1)?.length).toBeLessThanOrEqual(128);
  });
});
