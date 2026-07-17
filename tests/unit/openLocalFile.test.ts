import os from "node:os";
import { describe, expect, it, vi } from "vitest";

import { openLocalFile } from "../../src/utils/openLocalFile.js";

describe("offline report opener", () => {
  it("uses an executable and argv with shell disabled and an explicit cwd", async () => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    queueMicrotask(() => child.emitClose(0));

    await openLocalFile("/tmp/report with spaces.html", undefined, {
      platform: "darwin",
      spawnProcess,
    });

    expect(spawnProcess).toHaveBeenCalledWith("open", ["/tmp/report with spaces.html"], {
      cwd: os.tmpdir(),
      detached: false,
      shell: false,
      stdio: "ignore",
    });
  });

  it("waits for close after cancellation and reports interruption", async () => {
    const child = fakeChild();
    const controller = new AbortController();
    let closeEmitted = false;
    child.kill = vi.fn(() => {
      queueMicrotask(() => {
        closeEmitted = true;
        child.emitClose(null);
      });
      return true;
    });
    const promise = openLocalFile("/tmp/report.html", controller.signal, {
      platform: "linux",
      spawnProcess: vi.fn(() => child),
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(closeEmitted).toBe(true);
  });

  it("turns opener failure and unsupported platforms into infrastructure errors", async () => {
    const child = fakeChild();
    queueMicrotask(() => child.emitClose(7));
    await expect(
      openLocalFile("/tmp/report.html", undefined, {
        platform: "linux",
        spawnProcess: vi.fn(() => child),
      }),
    ).rejects.toMatchObject({ exitCode: 2 });

    await expect(
      openLocalFile("/tmp/report.html", undefined, { platform: "win32" }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});

function fakeChild() {
  let errorListener: ((error: Error) => void) | undefined;
  let closeListener: ((exitCode: number | null) => void) | undefined;
  return {
    kill: vi.fn(() => true),
    onError: (listener: (error: Error) => void) => {
      errorListener = listener;
    },
    onClose: (listener: (exitCode: number | null) => void) => {
      closeListener = listener;
    },
    emitError: (error: Error) => errorListener?.(error),
    emitClose: (exitCode: number | null) => closeListener?.(exitCode),
  };
}
