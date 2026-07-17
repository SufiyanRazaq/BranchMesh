import { createAbortError } from "../model/errors.js";

export interface OrderedMapOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
}

export async function mapLimitOrdered<Input, Output>(
  items: readonly Input[],
  limit: number,
  worker: (item: Input, index: number) => Promise<Output>,
  options: OrderedMapOptions = {},
): Promise<Output[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("Concurrency limit must be a positive safe integer");
  }
  if (isAborted(options.signal)) {
    throw createAbortError();
  }

  const results: Output[] = new Array<Output>(items.length);
  const completed = new Array<boolean>(items.length).fill(false);
  let nextIndex = 0;
  let firstError: unknown;

  const runLane = async (): Promise<void> => {
    while (firstError === undefined && !isAborted(options.signal)) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index] as Input;
      try {
        results[index] = await worker(item, index);
        completed[index] = true;
      } catch (error: unknown) {
        if (firstError === undefined) {
          firstError = error;
          options.onError?.(error);
        }
        return;
      }
    }
  };

  const laneCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: laneCount }, () => runLane()));
  if (firstError !== undefined) {
    throw normalizeError(firstError);
  }
  if (isAborted(options.signal)) {
    throw createAbortError();
  }
  if (completed.some((value) => !value)) {
    throw new Error("The bounded scheduler stopped before every item completed");
  }
  return results;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
