import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CommandRunner } from "../../src/engine/CommandRunner.js";

describe("CommandRunner", () => {
  it.skipIf(process.platform === "win32")(
    "does not allow background descendants to outlive the configured command",
    async () => {
      const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
      const markerPath = path.join(worktree, "background-marker");
      try {
        const execution = await new CommandRunner().run(
          {
            id: "background",
            label: "Background process test",
            kind: "custom",
            command:
              "node -e \"setTimeout(() => require('node:fs').writeFileSync('background-marker', 'unexpected'), 500)\" &",
            timeoutMs: 2_000,
          },
          worktree,
          { maximumLogBytes: 1024 },
        );

        expect(execution.result.status).toBe("passed");
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(await pathExists(markerPath)).toBe(false);
      } finally {
        await rm(worktree, { recursive: true });
      }
    },
  );

  it("bounds stdout and stderr without losing their total byte counts", async () => {
    const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
    try {
      const execution = await new CommandRunner().run(
        {
          id: "logs",
          label: "Large logs",
          kind: "custom",
          command:
            "node -e \"process.stdout.write('a'.repeat(10000)); process.stderr.write('b'.repeat(12000))\"",
          timeoutMs: 2_000,
        },
        worktree,
        { maximumLogBytes: 1024 },
      );

      expect(execution.result.stdout).toMatchObject({
        totalBytes: 10_000,
        capturedBytes: 1024,
        truncated: true,
      });
      expect(execution.result.stderr).toMatchObject({
        totalBytes: 12_000,
        capturedBytes: 1024,
        truncated: true,
      });
    } finally {
      await rm(worktree, { recursive: true });
    }
  });

  it("times out and terminates a command process tree", async () => {
    const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
    try {
      const execution = await new CommandRunner().run(
        {
          id: "timeout",
          label: "Timeout",
          kind: "custom",
          command: 'node -e "setTimeout(() => {}, 10000)"',
          timeoutMs: 50,
        },
        worktree,
        { maximumLogBytes: 1024, terminationGraceMs: 20 },
      );

      expect(execution.result.status).toBe("timed_out");
      expect(execution.result.timedOut).toBe(true);
      expect(execution.result.durationMs).toBeLessThan(2_000);
    } finally {
      await rm(worktree, { recursive: true });
    }
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
