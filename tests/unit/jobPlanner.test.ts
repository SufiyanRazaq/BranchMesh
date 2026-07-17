import { describe, expect, it } from "vitest";

import { planScanJobs } from "../../src/engine/JobPlanner.js";
import type { BranchSnapshot } from "../../src/model/results.js";

describe("deterministic job planning", () => {
  it("plans one job per branch and every unique canonical pair", () => {
    const branches = [
      snapshot("feature/a", "a"),
      snapshot("feature/b", "b"),
      snapshot("feature/c", "c"),
    ];
    const plan = planScanJobs(branches);

    expect(plan.branches.map((job) => [job.id, job.branches[0].ref])).toEqual([
      ["branch-0", "feature/a"],
      ["branch-1", "feature/b"],
      ["branch-2", "feature/c"],
    ]);
    expect(plan.pairs.map((job) => [job.id, ...job.branches.map((branch) => branch.ref)])).toEqual([
      ["pair-0-1", "feature/a", "feature/b"],
      ["pair-0-2", "feature/a", "feature/c"],
      ["pair-1-2", "feature/b", "feature/c"],
    ]);
  });

  it("rejects unordered snapshots instead of silently changing their identity", () => {
    expect(() => planScanJobs([snapshot("feature/b", "b"), snapshot("feature/a", "a")])).toThrow(
      /deterministically ordered/u,
    );
  });
});

function snapshot(ref: string, shaCharacter: string): BranchSnapshot {
  return {
    ref,
    fullRef: `refs/heads/${ref}`,
    sha: shaCharacter.repeat(40),
    changedFiles: [],
    dirty: false,
    worktreePath: null,
  };
}
