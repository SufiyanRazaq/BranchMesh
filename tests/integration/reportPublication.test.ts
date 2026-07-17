import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runScan } from "../../src/engine/runScan.js";
import { RunResultSchema } from "../../src/model/results.js";
import { ReportPublisher } from "../../src/report/ReportPublisher.js";
import { ReportProjectionSchema } from "../../src/report/schema.js";
import { resolveReportDirectories } from "../../src/utils/paths.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";
import { createReportFixture } from "../helpers/reportFixture.js";
import { listReportStagesForOutput, scanConfig } from "../helpers/scanTestSupport.js";

describe("report publication", () => {
  it("publishes redacted JSON, offline HTML, and separate logs without changing the repository", async () => {
    const repository = await TemporaryGitRepository.create();
    await repository.createBranch("feature/a", { "a.flag": "a\n" });
    await repository.createBranch("feature/b", { "b.flag": "b\n" });
    const stateBefore = await repository.captureState();
    const secret = "branchmesh-m4-secret-value";
    const previousSecret = process.env["BRANCHMESH_M4_SECRET"];
    process.env["BRANCHMESH_M4_SECRET"] = secret;

    try {
      const outcome = await runScan({
        repositoryPath: repository.repositoryPath,
        config: scanConfig(
          ["feature/a", "feature/b"],
          [
            {
              id: "evidence",
              label: "Evidence",
              kind: "custom",
              command:
                "node -e \"process.stdout.write(process.env.BRANCHMESH_M4_SECRET + '\\n\\u001b[31mred\\u001b[0m\\n' + process.cwd() + '\\n</script><b>hostile</b>\\n')\"",
              timeoutMs: 5_000,
            },
          ],
        ),
        toolVersion: "test",
        outputDirectory: repository.outputDirectory,
      });
      const resultText = await readFile(outcome.resultPath, "utf8");
      const html = await readFile(outcome.htmlPath, "utf8");
      const persisted = RunResultSchema.parse(JSON.parse(resultText));
      const logFiles = await listFiles(outcome.logsDirectory);
      const logs = await Promise.all(logFiles.map(async (file) => await readFile(file, "utf8")));
      const allPublishedText = [resultText, html, ...logs].join("\n");

      expect(persisted.repositoryRoot).toBe("[redacted]");
      expect(persisted.commonGitDirectory).toBe("[redacted]");
      expect(persisted.branches.every((branch) => branch.worktreePath === null)).toBe(true);
      expect(outcome.result).toEqual(persisted);
      expect(logFiles).toHaveLength(8);
      expect(allPublishedText).not.toContain(secret);
      expect(allPublishedText).not.toContain(repository.repositoryPath);
      expect(allPublishedText).not.toContain(outcome.executionRoot);
      expect(allPublishedText).not.toContain("\u001b");
      expect(html).toContain("&lt;/script&gt;&lt;b&gt;hostile&lt;/b&gt;");
      expect(extractEmbeddedProjection(html)).toSatisfy(
        (value: unknown) => ReportProjectionSchema.safeParse(value).success,
      );
      expect(await repository.captureState()).toEqual(stateBefore);
      expect(await repository.listWorktrees()).toEqual([path.resolve(repository.repositoryPath)]);
      expect(await listReportStagesForOutput(repository.outputDirectory)).toEqual([]);
    } finally {
      restoreEnvironment("BRANCHMESH_M4_SECRET", previousSecret);
      await repository.cleanup();
    }
  });

  it("uses fingerprint/run storage and atomically refreshes validated latest files", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-report-data-"));
    const result = createReportFixture();
    const directories = resolveReportDirectories(
      result.commonGitDirectory,
      result.runId,
      undefined,
      dataRoot,
    );
    const publisher = await ReportPublisher.create({
      outputDirectory: directories.runDirectory,
      latestDirectory: directories.latestDirectory,
      redaction: { environment: {} },
    });

    try {
      for (const job of result.jobs) {
        for (const [index, command] of job.commands.entries()) {
          await publisher.stageCommandLogs(job.id, index, command.id, {
            result: command,
            rawStdout: command.stdout,
            rawStderr: command.stderr,
          });
        }
      }
      const published = await publisher.publish(result);
      const latestDirectory = directories.latestDirectory;
      if (latestDirectory === null) {
        throw new Error("Default report directories require a latest location");
      }

      expect(published.resultPath).toBe(path.join(directories.runDirectory, "result.json"));
      expect(directories.runDirectory).toMatch(
        /repositories\/[0-9a-f]{16}\/runs\/20260717T100000-fixture$/u,
      );
      expect(await readFile(path.join(latestDirectory, "result.json"), "utf8")).toBe(
        await readFile(published.resultPath, "utf8"),
      );
      expect(await readFile(path.join(latestDirectory, "report.html"), "utf8")).toBe(
        await readFile(published.htmlPath, "utf8"),
      );
    } finally {
      await publisher.dispose();
      await rm(dataRoot, { recursive: true });
    }
  });

  it("does not remove a foreign file injected during failed publication rollback", async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-report-rollback-"));
    const outputDirectory = path.join(testRoot, "new-output");
    const result = createReportFixture();
    const publisher = await ReportPublisher.create({
      outputDirectory,
      latestDirectory: null,
      redaction: { environment: {} },
    });
    const logBytes = 2_000_000;
    const largeLog = {
      text: "x".repeat(logBytes),
      totalBytes: logBytes,
      capturedBytes: logBytes,
      truncated: false,
    } as const;
    const foreignPath = path.join(outputDirectory, "foreign-sentinel.txt");
    const reportPath = path.join(outputDirectory, "report.html");

    let publication: ReturnType<ReportPublisher["publish"]> | undefined;
    try {
      for (const job of result.jobs) {
        for (const [index, command] of job.commands.entries()) {
          await publisher.stageCommandLogs(job.id, index, command.id, {
            result: command,
            rawStdout: largeLog,
            rawStderr: largeLog,
          });
        }
      }

      publication = publisher.publish(result);
      await waitForPath(path.join(outputDirectory, "logs"));
      await Promise.all([
        writeFile(reportPath, "user-owned report\n", { encoding: "utf8", flag: "wx" }),
        writeFile(foreignPath, "do not remove\n", { encoding: "utf8", flag: "wx" }),
      ]);

      await expect(publication).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(reportPath, "utf8")).toBe("user-owned report\n");
      expect(await readFile(foreignPath, "utf8")).toBe("do not remove\n");
    } finally {
      await publication?.catch(() => undefined);
      await publisher.dispose();
      await rm(testRoot, { recursive: true });
    }
  });
});

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(candidate)));
    } else {
      files.push(candidate);
    }
  }
  return files.sort();
}

function extractEmbeddedProjection(html: string): unknown {
  const match = html.match(
    /<script id="branchmesh-report-data" type="application\/json">(?<json>.*?)<\/script>/su,
  );
  if (match?.groups?.["json"] === undefined) {
    throw new Error("Report projection script was not found");
  }
  return JSON.parse(match.groups["json"]);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function waitForPath(candidate: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await access(candidate);
      return;
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Path did not appear within 15 seconds: ${candidate}`);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
