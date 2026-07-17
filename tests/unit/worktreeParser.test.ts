import { describe, expect, it } from "vitest";

import { parseWorktreePorcelainZ } from "../../src/git/WorktreeParser.js";

describe("Git worktree porcelain -z parser", () => {
  it("preserves whitespace and parses branch, detached, locked, and prunable records", () => {
    const output = [
      "worktree /tmp/repository with spaces",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
      "worktree /tmp/detached",
      `HEAD ${"b".repeat(40)}`,
      "detached",
      "locked test reason",
      "",
      "worktree /tmp/gone",
      `HEAD ${"c".repeat(40)}`,
      "branch refs/heads/feature/gone",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\0");

    expect(parseWorktreePorcelainZ(output)).toEqual([
      {
        path: "/tmp/repository with spaces",
        head: "a".repeat(40),
        branch: "refs/heads/main",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      },
      {
        path: "/tmp/detached",
        head: "b".repeat(40),
        branch: null,
        detached: true,
        bare: false,
        locked: true,
        prunable: false,
      },
      {
        path: "/tmp/gone",
        head: "c".repeat(40),
        branch: "refs/heads/feature/gone",
        detached: false,
        bare: false,
        locked: false,
        prunable: true,
      },
    ]);
  });

  it("rejects records without an owning path", () => {
    expect(() => parseWorktreePorcelainZ(`HEAD ${"a".repeat(40)}\0\0`)).toThrow(/no path/u);
  });
});
