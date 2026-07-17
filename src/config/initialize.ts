import { randomUUID } from "node:crypto";
import { lstat, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertGitSuccess, GitClient } from "../git/GitClient.js";
import { RepositoryInspector } from "../git/RepositoryInspector.js";
import { ConfigurationError } from "../model/errors.js";
import { parseScanConfig, type ScanConfig, type ValidationCommand } from "./schema.js";
import { configFileName, readRegularTextFile } from "./loader.js";

interface PackageJson {
  readonly packageManager?: string | undefined;
  readonly scripts: Readonly<Record<string, string>>;
}

export interface InitializeOptions {
  readonly repositoryPath: string;
  readonly force: boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface InitializeOutcome {
  readonly configPath: string;
  readonly config: ScanConfig;
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun";
  readonly detectedLockfiles: readonly string[];
}

const lockfiles = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
] as const;

export async function initializeConfiguration(
  options: InitializeOptions,
): Promise<InitializeOutcome> {
  const git = new GitClient();
  const repository = await new RepositoryInspector(git).resolveRepositoryRoot(
    options.repositoryPath,
    options.signal,
  );
  const configPath = path.join(repository.root, configFileName);
  const existing = await lstatOrUndefined(configPath);
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new ConfigurationError(
        `${configFileName} must be a regular file and may not be a symbolic link`,
      );
    }
    if (!options.force) {
      throw new ConfigurationError(
        `${configFileName} already exists; use --force to replace it intentionally`,
      );
    }
  }

  const packageJson = await readPackageJson(repository.root);
  const detectedLockfiles = await detectLockfiles(repository.root);
  const packageManager = selectPackageManager(packageJson.packageManager, detectedLockfiles);
  const base = await selectBaseReference(
    git,
    repository.root,
    repository.commonGitDirectory,
    options.signal,
  );
  const commands = createValidationCommands(packageManager, packageJson.scripts);
  if (commands.length === 0) {
    throw new ConfigurationError(
      "No supported test, typecheck, lint, or build package script was found",
    );
  }

  const setup = createSetupCommand(packageManager, packageJson.packageManager, detectedLockfiles);
  const config = parseScanConfig({
    base,
    branches: { source: "worktrees", include: ["*"], exclude: [] },
    ...(setup === undefined ? {} : { setup }),
    commands,
  });
  await writeConfig(configPath, config, existing);
  return { configPath, config, packageManager, detectedLockfiles };
}

async function readPackageJson(repositoryRoot: string): Promise<PackageJson> {
  const packagePath = path.join(repositoryRoot, "package.json");
  let source: string;
  try {
    source = await readRegularTextFile(packagePath, "package.json");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ConfigurationError("No package.json was found at the repository root", {
        cause: error,
      });
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    throw new ConfigurationError("package.json is not valid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new ConfigurationError("package.json must contain a JSON object");
  }
  const scriptsValue = parsed["scripts"];
  const scripts: Record<string, string> = {};
  if (scriptsValue !== undefined) {
    if (!isRecord(scriptsValue)) {
      throw new ConfigurationError("package.json scripts must be an object");
    }
    for (const [name, value] of Object.entries(scriptsValue)) {
      if (typeof value === "string") {
        scripts[name] = value;
      }
    }
  }
  const packageManagerValue = parsed["packageManager"];
  return {
    scripts,
    ...(typeof packageManagerValue === "string" ? { packageManager: packageManagerValue } : {}),
  };
}

async function detectLockfiles(repositoryRoot: string): Promise<string[]> {
  const detected: string[] = [];
  for (const [fileName] of lockfiles) {
    const metadata = await lstatOrUndefined(path.join(repositoryRoot, fileName));
    if (metadata?.isFile() === true && !metadata.isSymbolicLink()) {
      detected.push(fileName);
    }
  }
  return detected;
}

function selectPackageManager(
  packageManagerField: string | undefined,
  detectedLockfiles: readonly string[],
): InitializeOutcome["packageManager"] {
  const declared = /^(npm|pnpm|yarn|bun)@/u.exec(packageManagerField ?? "")?.[1];
  if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") {
    return declared;
  }
  const detectedManagers = new Set(
    lockfiles
      .filter(([fileName]) => detectedLockfiles.includes(fileName))
      .map(([, packageManager]) => packageManager),
  );
  if (detectedManagers.size > 1) {
    throw new ConfigurationError(
      "Conflicting package-manager lockfiles were found; declare packageManager in package.json",
    );
  }
  for (const [fileName, packageManager] of lockfiles) {
    if (detectedLockfiles.includes(fileName)) {
      return packageManager;
    }
  }
  return "npm";
}

function createValidationCommands(
  packageManager: InitializeOutcome["packageManager"],
  scripts: Readonly<Record<string, string>>,
): ValidationCommand[] {
  const candidates = [
    ["test", ["test"]],
    ["typecheck", ["typecheck", "type-check", "check:types"]],
    ["lint", ["lint"]],
    ["build", ["build"]],
  ] as const;
  const commands: ValidationCommand[] = [];
  for (const [kind, names] of candidates) {
    const name = names.find((candidate) => scripts[candidate] !== undefined);
    if (name !== undefined) {
      commands.push({
        id: kind,
        label:
          kind === "typecheck"
            ? "Type checking"
            : `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}`,
        kind,
        command: `${packageManager} run ${name}`,
        timeoutMs: 120_000,
      });
    }
  }
  return commands;
}

function createSetupCommand(
  packageManager: InitializeOutcome["packageManager"],
  packageManagerField: string | undefined,
  detectedLockfiles: readonly string[],
): { command: string; timeoutMs: number } | undefined {
  const hasManagerLock = lockfiles.some(
    ([fileName, manager]) => manager === packageManager && detectedLockfiles.includes(fileName),
  );
  if (!hasManagerLock) {
    return undefined;
  }
  const yarnMajor = Number(/^yarn@(\d+)/u.exec(packageManagerField ?? "")?.[1] ?? "1");
  const command =
    packageManager === "npm"
      ? "npm ci --prefer-offline"
      : packageManager === "pnpm"
        ? "pnpm install --frozen-lockfile --prefer-offline"
        : packageManager === "yarn"
          ? yarnMajor >= 2
            ? "yarn install --immutable"
            : "yarn install --frozen-lockfile"
          : "bun install --frozen-lockfile";
  return { command, timeoutMs: 300_000 };
}

async function selectBaseReference(
  git: GitClient,
  repositoryRoot: string,
  commonGitDirectory: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  for (const candidate of ["main", "master"] as const) {
    const exists = await git.run(
      [
        "--git-dir",
        commonGitDirectory,
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${candidate}`,
      ],
      { cwd: os.tmpdir(), signal },
    );
    if (exists.exitCode === 0) {
      return candidate;
    }
  }
  const symbolic = assertGitSuccess(
    await git.run(["-C", repositoryRoot, "symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: os.tmpdir(),
      signal,
    }),
    "Base-branch discovery",
  ).stdout.trim();
  if (symbolic.length === 0) {
    throw new ConfigurationError("Could not determine a base branch");
  }
  return symbolic.startsWith("refs/heads/") ? symbolic.slice("refs/heads/".length) : symbolic;
}

async function writeConfig(
  configPath: string,
  config: ScanConfig,
  existing: Awaited<ReturnType<typeof lstat>> | undefined,
): Promise<void> {
  const source = `${JSON.stringify(config, null, 2)}\n`;
  if (existing === undefined) {
    try {
      await writeFile(configPath, source, { encoding: "utf8", flag: "wx", mode: 0o644 });
      return;
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new ConfigurationError(
          `${configFileName} appeared during initialization; retry with --force only after reviewing it`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  const temporaryPath = path.join(
    path.dirname(configPath),
    `.${configFileName}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", flag: "wx", mode: 0o644 });
    const current = await lstat(configPath);
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.dev !== existing.dev ||
      current.ino !== existing.ino
    ) {
      throw new ConfigurationError(
        `${configFileName} changed during initialization and will not be replaced`,
      );
    }
    await rename(temporaryPath, configPath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function lstatOrUndefined(
  candidate: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(candidate);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
