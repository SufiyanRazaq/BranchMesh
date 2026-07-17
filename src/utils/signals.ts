export interface SignalSource {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface RootCancellation {
  readonly signal: AbortSignal;
  dispose(): void;
}

export function installRootCancellation(source: SignalSource): RootCancellation {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  source.on("SIGINT", cancel);
  source.on("SIGTERM", cancel);
  return {
    signal: controller.signal,
    dispose: () => {
      source.removeListener("SIGINT", cancel);
      source.removeListener("SIGTERM", cancel);
    },
  };
}
