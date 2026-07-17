import { spawn } from "node:child_process";
import path from "node:path";

import type { ValidationCommand } from "../config/schema.js";
import { CommandResultSchema, type CommandResult } from "../model/results.js";

export interface CommandExecution {
  readonly result: CommandResult;
  readonly stdout: string;
  readonly stderr: string;
}

const gitContextVariables = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
] as const;

export class CommandRunner {
  public async run(
    command: ValidationCommand,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<CommandExecution> {
    if (!path.isAbsolute(cwd)) {
      throw new TypeError("Validation commands require an absolute cwd");
    }
    if (signal?.aborted === true) {
      throw createAbortError();
    }

    const startedAt = Date.now();
    const child = spawn(command.command, {
      cwd,
      detached: process.platform !== "win32",
      env: sanitizedEnvironment(),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    const processResult = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      let settled = false;
      let abortTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
        if (abortTimer !== undefined) {
          clearTimeout(abortTimer);
        }
      };
      const settleReject = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => {
        try {
          terminateProcessTree(child.pid, "SIGTERM");
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        abortTimer = setTimeout(() => {
          try {
            terminateProcessTree(child.pid, "SIGKILL");
            settleReject(createAbortError());
          } catch (error: unknown) {
            settleReject(error instanceof Error ? error : new Error(String(error)));
          }
        }, 250);
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      if (signal?.aborted === true) {
        onAbort();
      }

      child.once("error", (error) => {
        if (signal?.aborted !== true) {
          settleReject(error);
        }
      });
      child.once("close", (exitCode, processSignal) => {
        if (settled) {
          return;
        }
        if (signal?.aborted === true) {
          return;
        }
        try {
          // A configured shell command may have backgrounded descendants after exiting.
          // They share this detached process group and must not outlive the worktree.
          terminateProcessTree(child.pid, "SIGKILL");
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        settled = true;
        cleanup();
        resolve({ exitCode, signal: processSignal });
      });
    });

    return {
      result: CommandResultSchema.parse({
        ...command,
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        durationMs: Math.max(0, Date.now() - startedAt),
        status: processResult.exitCode === 0 ? "passed" : "failed",
      }),
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
  }
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const variable of gitContextVariables) {
    delete environment[variable];
  }
  return environment;
}

function createAbortError(): Error {
  const error = new Error("The validation command was cancelled");
  error.name = "AbortError";
  return error;
}

function terminateProcessTree(processId: number | undefined, signal: NodeJS.Signals): void {
  if (processId === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      process.kill(processId, signal);
    } else {
      process.kill(-processId, signal);
    }
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}
