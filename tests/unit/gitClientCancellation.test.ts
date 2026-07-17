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
}

describe("GitClient cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });

  it("does not reject cancellation until the Git process has closed", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
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
});
