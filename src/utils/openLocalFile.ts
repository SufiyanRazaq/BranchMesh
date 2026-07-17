import { spawn, type SpawnOptions } from "node:child_process";
import os from "node:os";

import { InfrastructureError, createAbortError } from "../model/errors.js";

export interface OpenLocalFileOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly cwd?: string | undefined;
  readonly spawnProcess?: LocalFileSpawn | undefined;
}

type LocalFileSpawn = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => LocalFileChild;

interface LocalFileChild {
  kill(signal: NodeJS.Signals): boolean;
  onError(listener: (error: Error) => void): void;
  onClose(listener: (exitCode: number | null) => void): void;
}

export async function openLocalFile(
  filePath: string,
  signal?: AbortSignal,
  options: OpenLocalFileOptions = {},
): Promise<void> {
  if (signal?.aborted === true) {
    throw createAbortError("Opening the BranchMesh report was cancelled");
  }
  const platform = options.platform ?? process.platform;
  const executable = platform === "darwin" ? "open" : "xdg-open";
  if (platform !== "darwin" && platform !== "linux") {
    throw new InfrastructureError("Opening reports is unsupported on this platform");
  }

  await new Promise<void>((resolve, reject) => {
    const spawnProcess: LocalFileSpawn = options.spawnProcess ?? spawnLocalFileProcess;
    const child = spawnProcess(executable, [filePath], {
      cwd: options.cwd ?? os.tmpdir(),
      detached: false,
      shell: false,
      stdio: "ignore",
    });
    let settled = false;
    let cancellationRequested = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onAbort = (): void => {
      cancellationRequested = true;
      child.kill("SIGTERM");
    };
    child.onError((error) =>
      finish(
        cancellationRequested
          ? createAbortError("Opening the BranchMesh report was cancelled")
          : new InfrastructureError(`Could not launch ${executable}`, { cause: error }),
      ),
    );
    child.onClose((exitCode) => {
      if (cancellationRequested) {
        finish(createAbortError("Opening the BranchMesh report was cancelled"));
      } else if (exitCode === 0) {
        finish();
      } else {
        finish(new InfrastructureError(`${executable} exited with code ${String(exitCode)}`));
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
    }
  });
}

const spawnLocalFileProcess: LocalFileSpawn = (executable, args, options) => {
  const child = spawn(executable, [...args], options);
  return {
    kill: (signal) => child.kill(signal),
    onError: (listener) => {
      child.once("error", listener);
    },
    onClose: (listener) => {
      child.once("close", listener);
    },
  };
};
