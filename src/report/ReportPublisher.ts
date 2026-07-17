import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CommandExecution } from "../engine/CommandRunner.js";
import { RunResultSchema, type RunResult } from "../model/results.js";
import { isPathInside } from "../utils/paths.js";
import {
  commandLogRelativePath,
  createRedactedRunResult,
  createReportProjection,
  createReportRedactor,
  safeCommandLogId,
  type ReportRedactionOptions,
} from "./projection.js";
import { renderOfflineHtml } from "./renderHtml.js";
import type { ReportProjection } from "./schema.js";

const markerFileName = ".branchmesh-report-stage.json";

interface StageMarker {
  readonly schemaVersion: 1;
  readonly owner: "branchmesh";
  readonly token: string;
  readonly outputDirectory: string;
}

export interface PublishedReport {
  readonly result: RunResult;
  readonly projection: ReportProjection;
  readonly resultPath: string;
  readonly htmlPath: string;
  readonly logsDirectory: string;
}

export interface ReportPublisherOptions {
  readonly outputDirectory: string;
  readonly latestDirectory: string | null;
  readonly redaction?: ReportRedactionOptions | undefined;
}

export class ReportPublisher {
  public readonly outputDirectory: string;
  public readonly latestDirectory: string | null;

  readonly #stageRoot: string;
  readonly #stageMarker: StageMarker;
  readonly #redactionEnvironment: NodeJS.ProcessEnv | undefined;
  readonly #additionalSensitiveValues: Set<string>;
  #disposed = false;
  #published = false;

  private constructor(
    outputDirectory: string,
    latestDirectory: string | null,
    stageRoot: string,
    stageMarker: StageMarker,
    redaction: ReportRedactionOptions,
  ) {
    this.outputDirectory = outputDirectory;
    this.latestDirectory = latestDirectory;
    this.#stageRoot = stageRoot;
    this.#stageMarker = stageMarker;
    this.#redactionEnvironment = redaction.environment;
    this.#additionalSensitiveValues = new Set(redaction.additionalSensitiveValues ?? []);
  }

  public addSensitiveValue(value: string): void {
    if (this.#published) {
      throw new Error("Cannot change report redaction after publication");
    }
    if (value.length > 0) {
      this.#additionalSensitiveValues.add(value);
    }
  }

  public static async create(options: ReportPublisherOptions): Promise<ReportPublisher> {
    const outputDirectory = path.resolve(options.outputDirectory);
    const latestDirectory =
      options.latestDirectory === null ? null : path.resolve(options.latestDirectory);
    const stageRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "branchmesh-report-stage-")),
    );

    try {
      await chmod(stageRoot, 0o700);
      const stageMarker: StageMarker = {
        schemaVersion: 1,
        owner: "branchmesh",
        token: randomUUID(),
        outputDirectory,
      };
      await writeFile(path.join(stageRoot, markerFileName), `${JSON.stringify(stageMarker)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await mkdir(path.join(stageRoot, "raw"), { mode: 0o700 });
      return new ReportPublisher(
        outputDirectory,
        latestDirectory,
        stageRoot,
        stageMarker,
        options.redaction ?? {},
      );
    } catch (error: unknown) {
      await rm(stageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  public async stageCommandLogs(
    jobId: string,
    commandIndex: number,
    commandId: string,
    execution: CommandExecution,
  ): Promise<void> {
    await this.#verifyStage();
    const rawDirectory = this.#resolveStagePath("raw", jobId);
    await mkdir(rawDirectory, { recursive: true, mode: 0o700 });
    await Promise.all([
      this.#writeStageFile(
        path.join(rawDirectory, rawLogFileName(commandIndex, commandId, "stdout")),
        execution.rawStdout.text,
      ),
      this.#writeStageFile(
        path.join(rawDirectory, rawLogFileName(commandIndex, commandId, "stderr")),
        execution.rawStderr.text,
      ),
    ]);
  }

  public async publish(result: RunResult): Promise<PublishedReport> {
    if (this.#published) {
      throw new Error("The BranchMesh report has already been published");
    }
    await this.#verifyStage();
    const validatedResult = RunResultSchema.parse(result);
    const redaction = this.#redactionOptions();
    const publishedResult = createRedactedRunResult(validatedResult, redaction);
    const projection = createReportProjection(validatedResult, redaction);
    const html = renderOfflineHtml(projection);
    const bundleDirectory = this.#resolveStagePath("bundle");
    const bundleLogsDirectory = path.join(bundleDirectory, "logs");
    await mkdir(bundleLogsDirectory, { recursive: true, mode: 0o700 });

    await Promise.all([
      this.#writeStageFile(
        path.join(bundleDirectory, "result.json"),
        `${JSON.stringify(publishedResult, null, 2)}\n`,
      ),
      this.#writeStageFile(path.join(bundleDirectory, "report.html"), html),
      this.#preparePublishedLogs(validatedResult, bundleLogsDirectory),
    ]);

    const resultPath = path.join(this.outputDirectory, "result.json");
    const htmlPath = path.join(this.outputDirectory, "report.html");
    const logsDirectory = path.join(this.outputDirectory, "logs");
    await this.#publishBundle(bundleDirectory, resultPath, htmlPath, logsDirectory);
    this.#published = true;

    if (this.latestDirectory !== null) {
      await publishLatest(
        this.latestDirectory,
        `${JSON.stringify(publishedResult, null, 2)}\n`,
        html,
      );
    }

    return { result: publishedResult, projection, resultPath, htmlPath, logsDirectory };
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    await this.#verifyStage();
    await rm(this.#stageRoot, { recursive: true });
    this.#disposed = true;
  }

  async #preparePublishedLogs(result: RunResult, logsDirectory: string): Promise<void> {
    const redactor = createReportRedactor(result, this.#redactionOptions());
    for (const job of result.jobs) {
      for (const [commandIndex, command] of job.commands.entries()) {
        const jobDirectory = path.join(logsDirectory, job.id);
        await mkdir(jobDirectory, { recursive: true, mode: 0o700 });
        for (const stream of ["stdout", "stderr"] as const) {
          const rawPath = this.#resolveStagePath(
            "raw",
            job.id,
            rawLogFileName(commandIndex, command.id, stream),
          );
          const rawLog = await readFile(rawPath, "utf8");
          const relativePath = commandLogRelativePath(job.id, commandIndex, command.id, stream);
          const publishedPath = path.join(logsDirectory, ...relativePath.split("/").slice(1));
          await this.#writeStageFile(
            publishedPath,
            ensureTrailingNewline(redactor.sanitizeEvidence(rawLog)),
          );
        }
      }
    }
  }

  async #publishBundle(
    bundleDirectory: string,
    resultPath: string,
    htmlPath: string,
    logsDirectory: string,
  ): Promise<void> {
    const existingOutput = await lstatOrUndefined(this.outputDirectory);
    let createdOutput = false;
    let publishedResult = false;
    let publishedHtml = false;
    const publishedLogFiles: string[] = [];
    const createdLogDirectories: string[] = [];

    if (existingOutput === undefined) {
      await mkdir(path.dirname(this.outputDirectory), { recursive: true, mode: 0o700 });
      await mkdir(this.outputDirectory, { mode: 0o700 });
      createdOutput = true;
    } else if (existingOutput.isSymbolicLink() || !existingOutput.isDirectory()) {
      throw new Error("The report output must be a regular directory, not a symbolic link");
    }

    try {
      await mkdir(logsDirectory, { mode: 0o700 });
      createdLogDirectories.push(logsDirectory);
      await copyDirectoryContents(
        path.join(bundleDirectory, "logs"),
        logsDirectory,
        publishedLogFiles,
        createdLogDirectories,
      );
      await publishExclusiveFile(path.join(bundleDirectory, "result.json"), resultPath, () => {
        publishedResult = true;
      });
      await publishExclusiveFile(path.join(bundleDirectory, "report.html"), htmlPath, () => {
        publishedHtml = true;
      });
    } catch (error: unknown) {
      if (publishedHtml) {
        await rm(htmlPath, { force: true });
      }
      if (publishedResult) {
        await rm(resultPath, { force: true });
      }
      for (const filePath of publishedLogFiles.reverse()) {
        await rm(filePath, { force: true });
      }
      for (const directory of createdLogDirectories.reverse()) {
        await removeEmptyDirectory(directory);
      }
      if (createdOutput) {
        await removeEmptyDirectory(this.outputDirectory);
      }
      throw error;
    }
  }

  async #writeStageFile(filePath: string, contents: string): Promise<void> {
    this.#assertStagePath(filePath);
    await writeFile(filePath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }

  #redactionOptions(): ReportRedactionOptions {
    return {
      ...(this.#redactionEnvironment === undefined
        ? {}
        : { environment: this.#redactionEnvironment }),
      additionalSensitiveValues: [...this.#additionalSensitiveValues],
    };
  }

  #resolveStagePath(...segments: readonly string[]): string {
    const candidate = path.resolve(this.#stageRoot, ...segments);
    this.#assertStagePath(candidate);
    return candidate;
  }

  #assertStagePath(candidate: string): void {
    if (!isPathInside(this.#stageRoot, candidate)) {
      throw new Error("Refusing a report staging path outside the owned staging root");
    }
  }

  async #verifyStage(): Promise<void> {
    if (this.#disposed) {
      throw new Error("The BranchMesh report staging root has already been removed");
    }
    const actualRoot = await realpath(this.#stageRoot);
    if (actualRoot !== this.#stageRoot) {
      throw new Error("Report staging root identity changed");
    }
    const temporaryDirectory = await realpath(os.tmpdir());
    if (!isPathInside(temporaryDirectory, actualRoot)) {
      throw new Error("Report staging root is not beneath os.tmpdir()");
    }
    const markerPath = path.join(this.#stageRoot, markerFileName);
    const metadata = await lstat(markerPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("The BranchMesh report staging marker is not a regular file");
    }
    const actualMarker = JSON.parse(await readFile(markerPath, "utf8")) as Partial<StageMarker>;
    if (
      actualMarker.schemaVersion !== this.#stageMarker.schemaVersion ||
      actualMarker.owner !== this.#stageMarker.owner ||
      actualMarker.token !== this.#stageMarker.token ||
      actualMarker.outputDirectory !== this.#stageMarker.outputDirectory
    ) {
      throw new Error("The BranchMesh report staging marker does not match");
    }
  }
}

async function copyDirectoryContents(
  source: string,
  destination: string,
  publishedFiles: string[],
  createdDirectories: string[],
): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { mode: 0o700 });
      createdDirectories.push(destinationPath);
      await copyDirectoryContents(sourcePath, destinationPath, publishedFiles, createdDirectories);
    } else if (entry.isFile()) {
      await publishExclusiveFile(sourcePath, destinationPath, () => {
        publishedFiles.push(destinationPath);
      });
    } else {
      throw new Error("Report bundles may contain only regular files and directories");
    }
  }
}

async function publishExclusiveFile(
  sourcePath: string,
  destinationPath: string,
  onPublished: () => void = () => undefined,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}-${randomUUID()}.tmp`,
  );
  try {
    await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL);
    await chmod(temporaryPath, 0o600);
    await link(temporaryPath, destinationPath);
    onPublished();
    await rm(temporaryPath);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST")
    ) {
      return;
    }
    throw error;
  }
}

function rawLogFileName(
  commandIndex: number,
  commandId: string,
  stream: "stdout" | "stderr",
): string {
  if (!Number.isInteger(commandIndex) || commandIndex < 0 || commandIndex > 50) {
    throw new TypeError("Invalid report command index");
  }
  return `${String(commandIndex).padStart(2, "0")}-${safeCommandLogId(commandId)}.${stream}.raw`;
}

async function publishLatest(
  latestDirectory: string,
  resultJson: string,
  html: string,
): Promise<void> {
  const existing = await lstatOrUndefined(latestDirectory);
  if (existing === undefined) {
    await mkdir(latestDirectory, { recursive: true, mode: 0o700 });
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error("The latest report location must be a regular directory");
  }

  await Promise.all([
    replaceRegularFileAtomically(path.join(latestDirectory, "result.json"), resultJson),
    replaceRegularFileAtomically(path.join(latestDirectory, "report.html"), html),
  ]);
}

async function replaceRegularFileAtomically(filePath: string, contents: string): Promise<void> {
  const existing = await lstatOrUndefined(filePath);
  if (existing?.isSymbolicLink() === true || (existing !== undefined && !existing.isFile())) {
    throw new Error(`Refusing to replace non-regular latest report file ${filePath}`);
  }

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") || value.length === 0 ? value : `${value}\n`;
}
