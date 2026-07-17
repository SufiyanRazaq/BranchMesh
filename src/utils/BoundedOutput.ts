import type { BoundedLog } from "../model/results.js";

export class BoundedOutput {
  readonly #headLimit: number;
  readonly #tailLimit: number;
  #head = Buffer.alloc(0);
  #tail = Buffer.alloc(0);
  #totalBytes = 0;

  public constructor(maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError("maximumBytes must be a positive safe integer");
    }
    this.#headLimit = Math.ceil(maximumBytes / 2);
    this.#tailLimit = Math.floor(maximumBytes / 2);
  }

  public append(chunk: Buffer): void {
    this.#totalBytes += chunk.length;
    let remainder = chunk;
    if (this.#head.length < this.#headLimit) {
      const headBytes = Math.min(this.#headLimit - this.#head.length, remainder.length);
      this.#head = Buffer.concat([this.#head, remainder.subarray(0, headBytes)]);
      remainder = remainder.subarray(headBytes);
    }
    if (remainder.length > 0 && this.#tailLimit > 0) {
      const combined = Buffer.concat([this.#tail, remainder]);
      this.#tail = combined.subarray(Math.max(0, combined.length - this.#tailLimit));
    }
  }

  public result(): BoundedLog {
    const capturedBytes = this.#head.length + this.#tail.length;
    const truncated = capturedBytes < this.#totalBytes;
    const text = truncated
      ? `${this.#head.toString("utf8")}\n… ${String(this.#totalBytes - capturedBytes)} bytes truncated …\n${this.#tail.toString("utf8")}`
      : Buffer.concat([this.#head, this.#tail]).toString("utf8");
    return { text, totalBytes: this.#totalBytes, capturedBytes, truncated };
  }
}
