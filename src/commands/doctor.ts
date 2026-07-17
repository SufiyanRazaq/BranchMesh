import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ScanConfig } from "../config/schema.js";
import { GitClient } from "../git/GitClient.js";
import { RepositoryInspector, type RepositorySnapshot } from "../git/RepositoryInspector.js";
import { ConfigurationError } from "../model/errors.js";
import {
  resolveReportDirectories,
  resolveSafeOutputDirectory,
  type ReportDirectories,
} from "../utils/paths.js";

export interface DoctorOptions {
  readonly repositoryPath: string;
  readonly config: ScanConfig;
  readonly outputDirectory?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly nodeVersion?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly status: "pass" | "warning";
}

export interface DoctorOutcome {
  readonly snapshot: RepositorySnapshot;
  readonly checks: readonly DoctorCheck[];
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorOutcome> {
  const git = new GitClient();
  const inspector = new RepositoryInspector(git, {
    neutralCwd: os.tmpdir(),
    temporaryStorageCheck: "access",
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.nodeVersion === undefined ? {} : { nodeVersion: options.nodeVersion }),
  });
  const snapshot = await inspector.preflight(
    options.repositoryPath,
    options.config,
    options.signal,
  );
  const configuredExecutables = [
    ...(options.config.setup === undefined ? [] : [options.config.setup.command]),
    ...options.config.commands.map((command) => command.command),
  ];
  const executableNames = new Set<string>();
  let unverifiedCommands = 0;
  for (const command of configuredExecutables) {
    const executable = extractExecutable(command);
    if (executable === null) {
      await assertExecutableFile("/bin/sh", "POSIX shell");
      unverifiedCommands += 1;
      continue;
    }
    if (executable.includes("/") && !path.isAbsolute(executable)) {
      unverifiedCommands += 1;
      continue;
    }
    await assertExecutableAvailable(
      executable,
      snapshot.repository.root,
      options.environment ?? process.env,
    );
    executableNames.add(executable);
    await assertKnownPackageScript(
      command,
      git,
      snapshot.repository.commonGitDirectory,
      snapshot.base.sha,
      options.signal,
    );
  }

  const reportDirectories = await validateReportStorage(
    snapshot,
    options.outputDirectory,
    options.environment,
  );
  const dirtySnapshots = [snapshot.base, ...snapshot.branches].filter((branch) => branch.dirty);
  const check = (
    id: string,
    label: string,
    detail: string,
    status: DoctorCheck["status"] = "pass",
  ): DoctorCheck => ({ id, label, detail, status });
  return {
    snapshot,
    checks: [
      check("platform", "Platform", snapshot.runtime.platform),
      check("node", "Node.js", snapshot.runtime.nodeVersion),
      check("git", "Git", snapshot.runtime.gitVersion),
      check("repository", "Repository and common Git directory", "valid"),
      check("configuration", "Configuration", "valid"),
      check("references", "Base and selected branch references", "resolved to immutable commits"),
      check(
        "worktrees",
        "Selected worktrees",
        dirtySnapshots.length === 0
          ? "supported and clean"
          : `${String(dirtySnapshots.length)} dirty worktree selection(s); committed tips only will be scanned`,
        dirtySnapshots.length === 0 ? "pass" : "warning",
      ),
      check("features", "Submodules and Git LFS", "not detected"),
      check(
        "executables",
        "Configured command entry points",
        unverifiedCommands === 0
          ? `${String(executableNames.size)} available`
          : `${String(executableNames.size)} available; ${String(unverifiedCommands)} complex command(s) deferred to scan`,
        unverifiedCommands === 0 ? "pass" : "warning",
      ),
      check("temporary-storage", "Temporary storage", "accessible"),
      check(
        "report-storage",
        "Report storage",
        reportDirectories.latestDirectory === null
          ? "explicit location accessible"
          : "user-data location accessible",
      ),
    ],
  };
}

function extractExecutable(command: string): string | null {
  let source = command;
  for (;;) {
    const assignment = /^\s*[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+/u.exec(source);
    if (assignment === null) {
      break;
    }
    source = source.slice(assignment[0].length);
  }
  let index = 0;
  while (index < source.length && /\s/u.test(source[index] ?? "")) {
    index += 1;
  }
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let token = "";
  for (; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (quote === null && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      if (quote === character) {
        quote = null;
      } else if (quote === null) {
        quote = character;
      } else {
        token += character;
      }
      continue;
    }
    if (quote === null && /\s/u.test(character)) {
      break;
    }
    token += character;
  }
  if (
    token.length === 0 ||
    quote !== null ||
    escaped ||
    /\s/u.test(token) ||
    new Set(["case", "for", "function", "if", "select", "until", "while"]).has(token) ||
    /[$`;&|<>()[\]{}*?]/u.test(token)
  ) {
    return null;
  }
  return token;
}

async function assertKnownPackageScript(
  command: string,
  git: GitClient,
  commonGitDirectory: string,
  baseSha: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const match =
    /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:_-]+)(?:\s|$)/u.exec(
      command,
    );
  if (match === null) {
    return;
  }
  let parsed: unknown;
  try {
    const packageResult = await git.run(
      ["--git-dir", commonGitDirectory, "show", `${baseSha}:package.json`],
      { cwd: os.tmpdir(), signal },
    );
    if (packageResult.exitCode !== 0) {
      throw new ConfigurationError("The captured base has no readable package.json");
    }
    parsed = JSON.parse(packageResult.stdout);
  } catch (error: unknown) {
    throw new ConfigurationError("A configured package script cannot be checked", {
      cause: error,
    });
  }
  const scripts = isRecord(parsed) && isRecord(parsed["scripts"]) ? parsed["scripts"] : undefined;
  const scriptName = match[2] ?? "";
  if (scripts === undefined || typeof scripts[scriptName] !== "string") {
    throw new ConfigurationError(`Configured package script '${scriptName}' does not exist`);
  }
}

async function assertExecutableAvailable(
  executable: string,
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const shellBuiltins = new Set([".", ":", "echo", "false", "printf", "test", "true"]);
  if (shellBuiltins.has(executable)) {
    return;
  }

  if (executable.includes("/")) {
    const candidate = path.isAbsolute(executable)
      ? path.resolve(executable)
      : path.resolve(repositoryRoot, executable);
    await assertExecutableFile(candidate, executable);
    return;
  }

  for (const directory of (environment["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(
      directory.length === 0
        ? repositoryRoot
        : path.isAbsolute(directory)
          ? directory
          : path.resolve(repositoryRoot, directory),
      executable,
    );
    try {
      await assertExecutableFile(candidate, executable);
      return;
    } catch (error: unknown) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EACCES")) {
        continue;
      }
      if (
        error instanceof ConfigurationError &&
        error.cause instanceof Error &&
        isNodeError(error.cause) &&
        (error.cause.code === "ENOENT" || error.cause.code === "EACCES")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new ConfigurationError(`Configured executable '${executable}' is not available`);
}

async function assertExecutableFile(candidate: string, displayName: string): Promise<void> {
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      if (!(await lstat(await realpath(candidate))).isFile()) {
        throw new ConfigurationError(`Configured executable '${displayName}' is not a file`);
      }
      await access(candidate, constants.X_OK);
      return;
    }
    if (!metadata.isFile()) {
      throw new ConfigurationError(`Configured executable '${displayName}' is not a file`);
    }
    await access(candidate, constants.X_OK);
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(`Configured executable '${displayName}' is not available`, {
      cause: error,
    });
  }
}

async function validateReportStorage(
  snapshot: RepositorySnapshot,
  outputDirectory: string | undefined,
  environment: NodeJS.ProcessEnv | undefined,
): Promise<ReportDirectories> {
  let directories = resolveReportDirectories(
    snapshot.repository.commonGitDirectory,
    "doctor-read-only-check",
    outputDirectory,
    undefined,
    environment,
  );
  const forbiddenRoots = [
    snapshot.repository.root,
    snapshot.repository.commonGitDirectory,
    ...snapshot.worktrees.filter((worktree) => !worktree.prunable).map((worktree) => worktree.path),
  ];
  for (const forbiddenRoot of forbiddenRoots) {
    directories = {
      runDirectory: await resolveSafeOutputDirectory(forbiddenRoot, directories.runDirectory),
      latestDirectory:
        directories.latestDirectory === null
          ? null
          : await resolveSafeOutputDirectory(forbiddenRoot, directories.latestDirectory),
    };
  }
  await assertWritableAncestor(directories.runDirectory);
  if (directories.latestDirectory !== null) {
    await assertWritableAncestor(directories.latestDirectory);
  }
  return directories;
}

async function assertWritableAncestor(candidate: string): Promise<void> {
  let current = path.resolve(candidate);
  for (;;) {
    try {
      const metadata = await lstat(current);
      if (!metadata.isDirectory()) {
        throw new ConfigurationError("Report storage has a non-directory ancestor");
      }
      await access(current, constants.R_OK | constants.W_OK | constants.X_OK);
      return;
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new ConfigurationError("No accessible report-storage ancestor was found", {
          cause: error,
        });
      }
      current = parent;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
