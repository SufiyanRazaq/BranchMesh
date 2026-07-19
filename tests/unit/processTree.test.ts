import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessTreeController, ProcessTreeTerminationError } from "../../src/utils/processTree.js";

describe("ProcessTreeController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when permission prevents both termination and the liveness probe", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw systemError("EPERM");
    });

    expect(() => new ProcessTreeController(4242).signal("SIGTERM")).toThrow(
      ProcessTreeTerminationError,
    );
  });

  it("stops signalling after a probe proves the process group is gone", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation((_processId, signal) => {
      if (signal === "SIGTERM") {
        throw systemError("EPERM");
      }
      if (signal === 0) {
        throw systemError("ESRCH");
      }
      return true;
    });
    const processTree = new ProcessTreeController(4242);

    expect(processTree.signal("SIGTERM")).toBe("gone");
    expect(processTree.signal("SIGKILL")).toBe("gone");
    expect(kill).toHaveBeenCalledTimes(2);
  });
});

function systemError(code: "EPERM" | "ESRCH"): Error & { code: string } {
  return Object.assign(new Error(`kill ${code}`), { code });
}
