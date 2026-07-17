import { describe, expect, it } from "vitest";

import { mapLimitOrdered } from "../../src/utils/mapLimitOrdered.js";

describe("bounded deterministic scheduler", () => {
  it("caps active work and returns input order despite reverse completion order", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapLimitOrdered([40, 30, 20, 10], 2, async (delay, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return `result-${String(index)}`;
    });

    expect(maximumActive).toBe(2);
    expect(results).toEqual(["result-0", "result-1", "result-2", "result-3"]);
  });

  it("stops scheduling after a worker failure and invokes the root abort hook", async () => {
    const cancellation = new AbortController();
    const started: number[] = [];

    await expect(
      mapLimitOrdered(
        [0, 1, 2, 3],
        1,
        (_item, index) => {
          started.push(index);
          if (index === 1) {
            throw new Error("worker failed");
          }
          return Promise.resolve(index);
        },
        { onError: (error) => cancellation.abort(error) },
      ),
    ).rejects.toThrow("worker failed");
    expect(started).toEqual([0, 1]);
    expect(cancellation.signal.aborted).toBe(true);
  });
});
