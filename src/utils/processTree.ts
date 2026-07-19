type ProcessTreeSignalOutcome = "signalled" | "gone";

export class ProcessTreeTerminationError extends Error {
  public override readonly cause: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ProcessTreeTerminationError";
    this.cause = cause;
  }
}

export class ProcessTreeController {
  readonly #target: number | undefined;
  #gone = false;

  public constructor(processId: number | undefined) {
    this.#target =
      processId === undefined ? undefined : process.platform === "win32" ? processId : -processId;
    this.#gone = processId === undefined;
  }

  public signal(signal: NodeJS.Signals): ProcessTreeSignalOutcome {
    if (this.#target === undefined || this.#gone) {
      return "gone";
    }

    const outcome = signalProcessTree(this.#target, signal);
    if (outcome === "gone") {
      this.#gone = true;
    }
    return outcome;
  }
}

export function isProcessTreeTerminationError(
  error: unknown,
): error is ProcessTreeTerminationError {
  return error instanceof ProcessTreeTerminationError;
}

function signalProcessTree(target: number, signal: NodeJS.Signals): ProcessTreeSignalOutcome {
  try {
    process.kill(target, signal);
    return "signalled";
  } catch (error: unknown) {
    if (isProcessError(error, "ESRCH")) {
      return "gone";
    }
    if (!isProcessError(error, "EPERM")) {
      throw terminationError(error);
    }

    // Darwin can report EPERM while a just-signalled process group is disappearing. Prove the
    // target no longer exists, or retry once if it still exists and has become signalable. A real
    // permission failure remains fatal so cleanup cannot race a live process tree.
    if (probeProcessTree(target) === "gone") {
      return "gone";
    }

    try {
      process.kill(target, signal);
      return "signalled";
    } catch (retryError: unknown) {
      if (isProcessError(retryError, "ESRCH")) {
        return "gone";
      }
      throw terminationError(retryError);
    }
  }
}

function probeProcessTree(target: number | undefined): "present" | "gone" {
  if (target === undefined) {
    return "gone";
  }
  try {
    process.kill(target, 0);
    return "present";
  } catch (error: unknown) {
    if (isProcessError(error, "ESRCH")) {
      return "gone";
    }
    throw terminationError(error);
  }
}

function terminationError(cause: unknown): ProcessTreeTerminationError {
  const code = cause instanceof Error && "code" in cause ? ` (${String(cause.code)})` : "";
  return new ProcessTreeTerminationError(
    `Process-tree termination could not be verified${code}`,
    cause,
  );
}

function isProcessError(error: unknown, code: "EPERM" | "ESRCH"): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
