import { spawn } from "node:child_process";
import path from "node:path";

import type { CommandKind } from "../config/schema.js";
import { createAbortError } from "../model/errors.js";
import { CommandResultSchema, type BoundedLog, type CommandResult } from "../model/results.js";
import { BoundedOutput } from "../utils/BoundedOutput.js";
import { ProcessTreeController } from "../utils/processTree.js";

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

const commandSupervisorSource = [
  'const { spawn } = require("node:child_process");',
  "const command = process.argv[1];",
  'process.on("SIGTERM", () => {});',
  'process.on("disconnect", () => {',
  '  if (process.platform === "win32") process.exit(1);',
  '  process.kill(-process.pid, "SIGKILL");',
  "});",
  'const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });',
  "child.stdout.pipe(process.stdout, { end: false });",
  "child.stderr.pipe(process.stderr, { end: false });",
  'child.once("error", (error) => process.send?.({ type: "error", message: error.message }));',
  'child.once("exit", (exitCode, signal) =>',
  '  process.send?.({ type: "exit", exitCode, signal }),',
  ");",
].join("\n");

interface SupervisorExitMessage {
  readonly type: "exit";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface SupervisorErrorMessage {
  readonly type: "error";
  readonly message: string;
}

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
    const child = spawn(
      process.execPath,
      ["--input-type=commonjs", "--eval", commandSupervisorSource, "--", command.command],
      {
        cwd,
        detached: process.platform !== "win32",
        env: sanitizedEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe", "ipc"] as const,
      },
    );
    const processTree = new ProcessTreeController(child.pid);
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (childStdout === null || childStderr === null) {
      processTree.signal("SIGKILL");
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("error", () => resolve());
        child.once("close", () => resolve());
      });
      throw new Error("The command supervisor did not provide output pipes");
    }
    childStdout.on("data", (chunk: Buffer) => {
      stdout.append(chunk);
      rawStdout.append(chunk);
    });
    childStderr.on("data", (chunk: Buffer) => {
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
      let finalSignalAttempted = false;
      let commandOutcome: SupervisorExitMessage | undefined;
      let supervisorError: Error | undefined;
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
          if (processTree.signal("SIGTERM") === "signalled") {
            killTimer = setTimeout(() => {
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
            }, options.terminationGraceMs ?? 250);
          }
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
      child.on("message", (message: unknown) => {
        if (settled || finalSignalAttempted) {
          return;
        }
        let parsed: SupervisorExitMessage | SupervisorErrorMessage;
        try {
          parsed = parseSupervisorMessage(message);
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (parsed.type === "exit") {
          commandOutcome = parsed;
        } else {
          supervisorError = new Error(
            `The command supervisor could not start the shell: ${parsed.message}`,
          );
        }
        try {
          // The supervisor remains the group leader after the configured shell exits, so this
          // signal cannot target a process group that reused a reaped leader PID.
          processTree.signal("SIGKILL");
          finalSignalAttempted = true;
        } catch (error: unknown) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.once("close", (exitCode, processSignal) => {
        if (settled) {
          return;
        }
        if (terminationReason === "abort") {
          settleReject(createAbortError("The validation command was cancelled"));
          return;
        }
        if (supervisorError !== undefined) {
          settleReject(supervisorError);
          return;
        }
        if (terminationReason === null && commandOutcome === undefined) {
          settleReject(new Error("The command supervisor closed without a command result"));
          return;
        }
        settled = true;
        cleanup();
        resolve({
          exitCode: commandOutcome === undefined ? exitCode : commandOutcome.exitCode,
          signal: commandOutcome === undefined ? processSignal : commandOutcome.signal,
          timedOut: terminationReason === "timeout",
        });
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

function parseSupervisorMessage(message: unknown): SupervisorExitMessage | SupervisorErrorMessage {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    throw new Error("The command supervisor emitted an invalid message");
  }
  if (message.type === "error" && "message" in message && typeof message.message === "string") {
    return { type: "error", message: message.message };
  }
  if (
    message.type === "exit" &&
    "exitCode" in message &&
    (typeof message.exitCode === "number" || message.exitCode === null) &&
    "signal" in message &&
    (typeof message.signal === "string" || message.signal === null)
  ) {
    return {
      type: "exit",
      exitCode: message.exitCode,
      signal: message.signal as NodeJS.Signals | null,
    };
  }
  throw new Error("The command supervisor emitted an invalid message");
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const variable of gitContextVariables) {
    delete environment[variable];
  }
  return environment;
}
