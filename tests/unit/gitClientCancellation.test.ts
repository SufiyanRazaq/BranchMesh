import { EventEmitter } from "node:events";
import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { GitClient } from "../../src/git/GitClient.js";

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  public readonly pid = 4242;
  public readonly stdout = new FakeStream();
  public readonly stderr = new FakeStream();
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
}

describe("GitClient cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });

  it("does not reject cancellation until the Git process has closed", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockImplementation((_processId, signal) => {
      if (signal === 0) {
        throw systemError("ESRCH");
      }
      return true;
    });
    const cancellation = new AbortController();
    let settled = false;

    try {
      const command = new GitClient().run(["status"], {
        cwd: os.tmpdir(),
        signal: cancellation.signal,
      });
      const observed = command.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      cancellation.abort();
      await vi.advanceTimersByTimeAsync(250);
      expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
      expect(settled).toBe(false);

      child.emit("close", null, "SIGKILL");
      await expect(command).rejects.toMatchObject({ name: "AbortError" });
      await observed;
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  });

  it("proves a disappearing process group is gone when initial cancellation reports EPERM", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockImplementation((_processId, signal) => {
      if (signal === "SIGTERM") {
        throw systemError("EPERM");
      }
      if (signal === 0) {
        throw systemError("ESRCH");
      }
      return true;
    });
    const cancellation = new AbortController();

    try {
      const command = new GitClient().run(["status"], {
        cwd: os.tmpdir(),
        signal: cancellation.signal,
      });

      cancellation.abort();
      child.emit("close", null, "SIGTERM");

      await expect(command).rejects.toMatchObject({ name: "AbortError" });
      expect(kill).toHaveBeenCalledWith(-child.pid, 0);
      expect(kill).not.toHaveBeenCalledWith(-child.pid, "SIGKILL");
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not signal a stale process-group ID after Git has exited but before close", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw systemError("EPERM");
    });
    const cancellation = new AbortController();

    try {
      const command = new GitClient().run(["status"], {
        cwd: os.tmpdir(),
        signal: cancellation.signal,
      });

      child.exitCode = 0;
      cancellation.abort();
      child.emit("close", 0, null);

      await expect(command).rejects.toMatchObject({ name: "AbortError" });
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  });
});

function systemError(code: "EPERM" | "ESRCH"): Error & { code: string } {
  return Object.assign(new Error(`kill ${code}`), { code });
}
