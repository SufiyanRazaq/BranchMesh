import { access, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ExecutionOwnership } from "../../src/engine/ownership.js";

describe("execution ownership", () => {
  it("refuses cleanup after its ownership marker is altered", async () => {
    const ownership = await ExecutionOwnership.create({
      runId: "ownership-test",
      repository: {
        root: path.join(os.tmpdir(), "example-repository"),
        commonGitDirectory: path.join(os.tmpdir(), "example-repository", ".git"),
      },
      base: snapshot("main", "a", "refs/heads/main"),
      branches: [
        snapshot("feature/a", "b", "refs/heads/feature/a"),
        snapshot("feature/b", "c", "refs/heads/feature/b"),
      ],
    });
    const markerPath = path.join(ownership.root, ".branchmesh-owner.json");
    const originalMarker = await readFile(markerPath, "utf8");

    try {
      const parsedMarker: unknown = JSON.parse(originalMarker);
      if (!isRecord(parsedMarker)) {
        throw new TypeError("Expected an ownership marker object");
      }
      const alteredMarker = { ...parsedMarker, runId: "altered-run" };
      await writeFile(markerPath, `${JSON.stringify(alteredMarker)}\n`, "utf8");

      await expect(ownership.removeRoot()).rejects.toThrow(/ownership run ID/u);
      expect(await pathExists(ownership.root)).toBe(true);
    } finally {
      await writeFile(markerPath, originalMarker, "utf8");
      await ownership.removeRoot();
    }

    expect(await pathExists(ownership.root)).toBe(false);
  });
});

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshot(ref: string, shaCharacter: string, fullRef: string) {
  return {
    ref,
    fullRef,
    sha: shaCharacter.repeat(40),
    changedFiles: [],
    dirty: false,
    worktreePath: null,
  };
}
