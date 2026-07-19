import { spawn } from "node:child_process";
import path from "node:path";

import { ProcessTreeController } from "../utils/processTree.js";

export interface GitCommandResult {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
}

export interface GitCommandOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
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

export class GitCommandError extends Error {
  public readonly result: GitCommandResult;

  public constructor(message: string, result: GitCommandResult) {
    super(message);
    this.name = "GitCommandError";
    this.result = result;
  }
}

export class GitClient {
  public async run(args: readonly string[], options: GitCommandOptions): Promise<GitCommandResult> {
    if (!path.isAbsolute(options.cwd)) {
      throw new TypeError("Git commands require an absolute cwd");
    }

    throwIfAborted(options.signal);

    const startedAt = Date.now();
    const child = spawn("git", [...args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: gitEnvironment(options.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const processTree = new ProcessTreeController(child.pid);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    return await new Promise<GitCommandResult>((resolve, reject) => {
      let settled = false;
      let cancellationRequested = false;
      let finalSignalAttempted = false;
      let abortTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        options.signal?.removeEventListener("abort", onAbort);
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
        if (settled || cancellationRequested) {
          return;
        }
        cancellationRequested = true;
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        try {
          processTree.signal("SIGTERM");
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        abortTimer = setTimeout(() => {
          try {
            if (!finalSignalAttempted) {
              if (child.exitCode === null && child.signalCode === null) {
                processTree.signal("SIGKILL");
                finalSignalAttempted = true;
              }
            }
          } catch (error: unknown) {
            settleReject(error instanceof Error ? error : new Error(String(error)));
          }
        }, 250);
      };

      options.signal?.addEventListener("abort", onAbort, { once: true });

      if (options.signal?.aborted === true) {
        onAbort();
      }

      child.once("error", (error) => {
        settleReject(cancellationRequested ? createAbortError() : error);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) {
          return;
        }

        if (cancellationRequested) {
          settleReject(createAbortError());
          return;
        }

        settled = true;
        cleanup();
        resolve({
          args: [...args],
          cwd: options.cwd,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode,
          signal,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      });
    });
  }
}

function gitEnvironment(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const variable of gitContextVariables) {
    delete environment[variable];
  }
  return { ...environment, ...overrides };
}

export function assertGitSuccess(result: GitCommandResult, operation: string): GitCommandResult {
  if (result.exitCode === 0) {
    return result;
  }

  const detail = result.stderr.trim() || result.stdout.trim() || "Git exited without output";
  throw new GitCommandError(`${operation} failed: ${detail}`, result);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("The Git command was cancelled");
  error.name = "AbortError";
  return error;
}
