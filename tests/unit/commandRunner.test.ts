import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

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

        expect(execution.result.status, JSON.stringify(execution.result)).toBe("passed");
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
      expect(execution.rawStdout).toMatchObject({
        totalBytes: 10_000,
        capturedBytes: 10_000,
        truncated: false,
      });
      expect(execution.rawStderr).toMatchObject({
        totalBytes: 12_000,
        capturedBytes: 12_000,
        truncated: false,
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

  it("does not let Node parse a leading-hyphen configured command", async () => {
    const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
    try {
      const execution = await new CommandRunner().run(
        {
          id: "leading-hyphen",
          label: "Leading hyphen",
          kind: "custom",
          command: "-branchmesh-command-that-does-not-exist",
          timeoutMs: 2_000,
        },
        worktree,
        { maximumLogBytes: 1024 },
      );

      expect(execution.result.status).toBe("failed");
      expect(execution.result.exitCode).not.toBe(0);
      expect(execution.result.stderr.totalBytes).toBeGreaterThan(0);
    } finally {
      await rm(worktree, { recursive: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "accepts EPERM only when the final group kill is proven complete",
    async () => {
      const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
      const originalKill = process.kill.bind(process);
      let groupKillAttempts = 0;
      let groupProbeAttempts = 0;
      const kill = vi.spyOn(process, "kill").mockImplementation((processId, signal) => {
        if (processId < 0 && signal === "SIGKILL") {
          groupKillAttempts += 1;
          if (groupKillAttempts === 1) {
            originalKill(processId, signal);
            throw systemError("EPERM");
          }
        }
        if (processId < 0 && signal === 0) {
          groupProbeAttempts += 1;
          throw systemError("ESRCH");
        }
        return originalKill(processId, signal);
      });

      try {
        const execution = await new CommandRunner().run(
          {
            id: "close-permission-race",
            label: "Close permission race",
            kind: "custom",
            command: 'node -e "process.exit(0)"',
            timeoutMs: 2_000,
          },
          worktree,
          { maximumLogBytes: 1024 },
        );

        expect(execution.result.status).toBe("passed");
        expect(groupKillAttempts).toBe(1);
        expect(groupProbeAttempts).toBe(1);
      } finally {
        kill.mockRestore();
        await rm(worktree, { recursive: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not repeat process-group termination after the final group kill",
    async () => {
      const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
      const originalKill = process.kill.bind(process);
      let groupKillAttempts = 0;
      let groupProbeAttempts = 0;
      const kill = vi.spyOn(process, "kill").mockImplementation((processId, signal) => {
        if (processId < 0 && signal === "SIGKILL") {
          groupKillAttempts += 1;
          if (groupKillAttempts === 1) {
            return originalKill(processId, signal);
          }
          if (groupKillAttempts === 2) {
            throw systemError("EPERM");
          }
        }
        if (processId < 0 && signal === 0) {
          groupProbeAttempts += 1;
          throw systemError("ESRCH");
        }
        return originalKill(processId, signal);
      });

      try {
        const execution = await new CommandRunner().run(
          {
            id: "close-permission-race",
            label: "Close permission race",
            kind: "custom",
            command: 'node -e "process.exit(0)"',
            timeoutMs: 2_000,
          },
          worktree,
          { maximumLogBytes: 1024 },
        );

        expect(execution.result.status).toBe("passed");
        expect(groupKillAttempts).toBe(1);
        expect(groupProbeAttempts).toBe(0);
      } finally {
        kill.mockRestore();
        await rm(worktree, { recursive: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps the supervisor group leader alive through the final group signal",
    async () => {
      const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
      const originalKill = process.kill.bind(process);
      let finalGroupKills = 0;
      let leaderWasAlive = false;
      const kill = vi.spyOn(process, "kill").mockImplementation((processId, signal) => {
        if (processId < 0 && signal === "SIGKILL") {
          finalGroupKills += 1;
          leaderWasAlive = originalKill(-processId, 0);
        }
        return originalKill(processId, signal);
      });

      try {
        const execution = await new CommandRunner().run(
          {
            id: "pid-reuse",
            label: "PID reuse",
            kind: "custom",
            command: 'node -e "process.exit(0)"',
            timeoutMs: 2_000,
          },
          worktree,
          { maximumLogBytes: 1024 },
        );

        expect(execution.result.status).toBe("passed");
        expect(leaderWasAlive).toBe(true);
        expect(finalGroupKills).toBe(1);
      } finally {
        kill.mockRestore();
        await rm(worktree, { recursive: true });
      }
    },
  );
});

function systemError(code: "EPERM" | "ESRCH"): Error & { code: string } {
  return Object.assign(new Error(`kill ${code}`), { code });
}

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
