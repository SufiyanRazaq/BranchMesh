import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { installRootCancellation, type SignalSource } from "../../src/utils/signals.js";

describe("root cancellation", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("aborts on %s and removes both handlers", (signal) => {
    const source = new EventEmitter() as SignalSource & EventEmitter;
    const cancellation = installRootCancellation(source);

    source.emit(signal);
    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(source.listenerCount("SIGTERM")).toBe(0);
  });
});
