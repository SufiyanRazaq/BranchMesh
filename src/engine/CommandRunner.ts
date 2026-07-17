import { spawn } from "node:child_process";
import path from "node:path";

import type { CommandKind } from "../config/schema.js";
import { createAbortError } from "../model/errors.js";
import { CommandResultSchema, type BoundedLog, type CommandResult } from "../model/results.js";
import { BoundedOutput } from "../utils/BoundedOutput.js";

export interface PipelineCommand {
  readonly id: string;
  readonly label: string;
  readonly kind: CommandKind;
  readonly command: string;
  readonly timeoutMs: number;
}

export interface CommandRunOptions {
  readonly signal?: AbortSignal | undefined;
  readonly maximumLogBytes: number;
  readonly maximumRawLogBytes?: number | undefined;
  readonly terminationGraceMs?: number | undefined;
}

export interface CommandExecution {
  readonly result: CommandResult;
  readonly rawStdout: BoundedLog;
  readonly rawStderr: BoundedLog;
}

export const maximumRawLogBytes = 5_000_000;

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
    command: PipelineCommand,
    cwd: string,
    options: CommandRunOptions,
  ): Promise<CommandExecution> {
    if (!path.isAbsolute(cwd)) {
      throw new TypeError("Validation commands require an absolute cwd");
    }
    if (options.signal?.aborted === true) {
      throw createAbortError("The validation command was cancelled");
    }

    const startedAt = Date.now();
    const stdout = new BoundedOutput(options.maximumLogBytes);
    const stderr = new BoundedOutput(options.maximumLogBytes);
    const rawStdout = new BoundedOutput(options.maximumRawLogBytes ?? maximumRawLogBytes);
    const rawStderr = new BoundedOutput(options.maximumRawLogBytes ?? maximumRawLogBytes);
    const child = spawn(command.command, {
      cwd,
      detached: process.platform !== "win32",
      env: sanitizedEnvironment(),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.append(chunk);
      rawStdout.append(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.append(chunk);
      rawStderr.append(chunk);
    });

    const processResult = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
    }>((resolve, reject) => {
      let settled = false;
      let terminationReason: "abort" | "timeout" | null = null;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutTimer = setTimeout(() => requestTermination("timeout"), command.timeoutMs);

      const cleanup = (): void => {
        options.signal?.removeEventListener("abort", onAbort);
        clearTimeout(timeoutTimer);
        if (killTimer !== undefined) {
          clearTimeout(killTimer);
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
      const requestTermination = (reason: "abort" | "timeout"): void => {
        if (settled || terminationReason !== null) {
          return;
        }
        terminationReason = reason;
        try {
          terminateProcessTree(child.pid, "SIGTERM");
          killTimer = setTimeout(() => {
            try {
              terminateProcessTree(child.pid, "SIGKILL");
            } catch (error: unknown) {
              settleReject(error instanceof Error ? error : new Error(String(error)));
            }
          }, options.terminationGraceMs ?? 250);
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const onAbort = (): void => requestTermination("abort");

      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted === true) {
        onAbort();
      }

      child.once("error", (error) => {
        if (terminationReason === "abort") {
          settleReject(createAbortError("The validation command was cancelled"));
        } else {
          settleReject(error);
        }
      });
      child.once("exit", () => {
        if (settled) {
          return;
        }
        try {
          // The shell can exit while background descendants retain its output pipes. Terminating
          // the group on the process exit event ensures the later close event cannot wait on them.
          terminateProcessTree(child.pid, "SIGKILL");
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.once("close", (exitCode, processSignal) => {
        if (settled) {
          return;
        }
        try {
          // Configured commands are the sole shell boundary. Kill any background descendants in
          // the detached process group before their temporary worktree can be removed.
          terminateProcessTree(child.pid, "SIGKILL");
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (terminationReason === "abort") {
          settleReject(createAbortError("The validation command was cancelled"));
          return;
        }
        settled = true;
        cleanup();
        resolve({ exitCode, signal: processSignal, timedOut: terminationReason === "timeout" });
      });
    });

    const stdoutResult = stdout.result();
    const stderrResult = stderr.result();
    const status = processResult.timedOut
      ? "timed_out"
      : processResult.exitCode === 0 && processResult.signal === null
        ? "passed"
        : "failed";
    return {
      result: CommandResultSchema.parse({
        ...command,
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        durationMs: Math.max(0, Date.now() - startedAt),
        status,
        timedOut: processResult.timedOut,
        stdout: stdoutResult,
        stderr: stderrResult,
      }),
      rawStdout: rawStdout.result(),
      rawStderr: rawStderr.result(),
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
