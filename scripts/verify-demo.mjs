import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-demo-verify-"));

try {
  const repositoryStateBefore = await captureProjectRepositoryState();
  const outputDirectory = path.join(harnessRoot, "result");
  const demoProcess = await runProcess(
    process.execPath,
    [path.join(projectRoot, "dist", "cli.js"), "demo", "--output", outputDirectory, "--json"],
    os.tmpdir(),
  );

  assert.equal(
    demoProcess.exitCode,
    1,
    `The real demo scan must exit 1. stderr: ${demoProcess.stderr}`,
  );
  const evidence = JSON.parse(demoProcess.stdout);
  const canonicalOutputDirectory = await realpath(outputDirectory);
  assert.equal(evidence.scanExitCode, 1);
  assert.equal(evidence.repositoryUnchanged, true);
  assert.equal(evidence.temporaryWorktreesRemaining, 0);
  assert.equal(path.dirname(evidence.resultPath), canonicalOutputDirectory);
  assert.equal(evidence.htmlPath, path.join(canonicalOutputDirectory, "report.html"));
  assert.equal(evidence.logsDirectory, path.join(canonicalOutputDirectory, "logs"));
  assert.equal(evidence.base, "BASE_PASS");
  assert.deepEqual(
    evidence.branches.map((branch) => branch.classification),
    ["BRANCH_PASS", "BRANCH_PASS", "BRANCH_PASS"],
  );
  assert.deepEqual(
    evidence.pairs.map((pair) => [pair.refs, pair.classification]),
    [
      [["feature/config-seconds", "feature/jitter"], "BEHAVIORAL_CONFLICT"],
      [["feature/config-seconds", "feature/status-output"], "NO_DETECTED_CONFLICT"],
      [["feature/jitter", "feature/status-output"], "NO_DETECTED_CONFLICT"],
    ],
  );
  assert.equal(evidence.pairs[0].technicalClassification, "PAIR_TEST_FAILURE");
  assert.deepEqual(evidence.pairs[0].conflictedFiles, []);

  const result = JSON.parse(await readFile(evidence.resultPath, "utf8"));
  const baseJob = result.jobs.find((job) => job.kind === "base");
  const branchJobs = result.jobs.filter((job) => job.kind === "branch");
  const pairJobs = result.jobs.filter((job) => job.kind === "pair");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.repositoryRoot, "[redacted]");
  assert.equal(result.commonGitDirectory, "[redacted]");
  assert.equal(
    result.branches.every((branch) => branch.worktreePath === null),
    true,
  );
  assert.equal(result.exitCode, 1);
  assert.equal(baseJob.classification, "BASE_PASS");
  assert.equal(baseJob.commands[0].status, "passed");
  assert.deepEqual(
    branchJobs.map((job) => job.classification),
    ["BRANCH_PASS", "BRANCH_PASS", "BRANCH_PASS"],
  );
  assert.deepEqual(
    branchJobs.map((job) => job.commands[0].status),
    ["passed", "passed", "passed"],
  );
  assert.deepEqual(
    pairJobs.map((job) => job.classification),
    ["BEHAVIORAL_CONFLICT", "NO_DETECTED_CONFLICT", "NO_DETECTED_CONFLICT"],
  );
  assert.equal(pairJobs[0].technicalClassification, "PAIR_TEST_FAILURE");
  assert.equal(pairJobs[0].commands[0].status, "failed");
  assert.deepEqual(pairJobs[0].conflictedFiles, []);
  assert.equal(result.summary.branchCount, 3);
  assert.equal(result.summary.pairCount, 3);
  assert.equal(result.summary.behavioralConflicts, 1);
  assert.equal(result.summary.textualConflicts, 0);
  const html = await readFile(evidence.htmlPath, "utf8");
  assert.match(html, /Compatibility matrix/u);
  assert.match(html, /No detected conflict/u);
  assert.match(html, /Behavioral conflict/u);
  assert.match(html, /PAIR_TEST_FAILURE/u);
  assert.match(html, /Limitations/u);
  assert.match(html, /@media print/u);
  assert.doesNotMatch(html, /Guaranteed safe/u);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/iu);
  assert.doesNotMatch(html, /fetch\(/u);
  assert.equal((html.match(/<\/script>/gu) ?? []).length, 2);
  const logFiles = await listFiles(evidence.logsDirectory);
  assert.equal(logFiles.length, 14);
  assert.deepEqual(await reportStagesForOutput(canonicalOutputDirectory), []);
  assert.equal(await pathExists(evidence.executionRoot), false);
  assert.equal(await pathExists(evidence.demoRoot), false);
  assert.equal(await pathExists(evidence.demoRepository), false);

  const repositoryStateAfter = await captureProjectRepositoryState();
  assert.equal(
    repositoryStateAfter,
    repositoryStateBefore,
    "The BranchMesh project repository changed while the demo ran",
  );

  process.stdout.write(
    [
      "BranchMesh demo verification passed.",
      "Actual scan exit code: 1 (expected incompatibility)",
      "Base: BASE_PASS",
      "Branches: BRANCH_PASS, BRANCH_PASS, BRANCH_PASS",
      "Pairs: 1 BEHAVIORAL_CONFLICT (PAIR_TEST_FAILURE), 2 NO_DETECTED_CONFLICT",
      "Textual conflicts: 0",
      "Offline HTML report: validated",
      "Separate raw logs: 14 files",
      "Temporary worktrees remaining: 0",
      "Project repository unchanged: yes",
    ].join("\n") + "\n",
  );
} finally {
  await rm(harnessRoot, { recursive: true });
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(candidate)));
    } else {
      files.push(candidate);
    }
  }
  return files;
}

async function reportStagesForOutput(outputDirectory) {
  const stages = [];
  for (const entry of await readdir(os.tmpdir())) {
    if (!entry.startsWith("branchmesh-report-stage-")) continue;
    const stageRoot = path.join(os.tmpdir(), entry);
    try {
      const marker = JSON.parse(
        await readFile(path.join(stageRoot, ".branchmesh-report-stage.json"), "utf8"),
      );
      if (marker.outputDirectory === outputDirectory) stages.push(stageRoot);
    } catch (error) {
      if (!(error instanceof Error && error.code === "ENOENT")) throw error;
    }
  }
  return stages;
}

async function captureProjectRepositoryState() {
  const outputs = [];
  for (const args of [
    ["-C", projectRoot, "rev-parse", "HEAD"],
    ["-C", projectRoot, "status", "--porcelain=v1", "--untracked-files=all"],
    ["-C", projectRoot, "worktree", "list", "--porcelain", "-z"],
  ]) {
    const result = await runProcess("git", args, os.tmpdir());
    assert.equal(result.exitCode, 0, result.stderr);
    outputs.push(result.stdout);
  }
  return outputs.join("\u0000");
}

async function runProcess(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
