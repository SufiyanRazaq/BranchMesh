import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "../../../..");
const cliPath = path.join(projectRoot, "dist", "cli.js");
const contractsPath = path.join(projectRoot, "dist", "contracts.js");
const maximumResultBytes = 256 * 1024 * 1024;
const maximumEvidenceCharacters = 2_000;
const allowedCompletedScanCodes = new Set([0, 1, 3]);
const gitContextVariables = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
];
let activeChild = null;
let interrupted = false;

class SkillInterruptedError extends Error {
  constructor() {
    super("BranchMesh skill execution was interrupted");
    this.name = "SkillInterruptedError";
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`BranchMesh skill error: ${message}\n`);
    process.exitCode = 2;
  }
}

async function main(arguments_) {
  const signals = installSignalForwarding();
  try {
    const [mode, ...rest] = arguments_;
    await requireBuiltArtifact(cliPath, "CLI");
    assertNotInterrupted();
    await requireBuiltArtifact(contractsPath, "compiled contracts");
    assertNotInterrupted();
    const contracts = await import(pathToFileURL(contractsPath).href);
    assertNotInterrupted();

    if (mode === "scan") {
      return await runScanWorkflow(parseScanArguments(rest), contracts);
    }
    if (mode === "demo") {
      return await runDemoWorkflow(parseDemoArguments(rest), contracts);
    }
    if (mode === "validate") {
      if (rest.length !== 1 || rest[0] === undefined) {
        throw new Error("Usage: run-branchmesh.mjs validate <result.json>");
      }
      const resultPath = path.resolve(rest[0]);
      const result = await readValidatedResult(resultPath, contracts.RunResultSchema);
      assertNotInterrupted();
      assertPublishedRedaction(result);
      await assertPublishedBundle(resultPath);
      assertNotInterrupted();
      writeEnvelope(createEnvelope(result, resultPath, null));
      return 0;
    }

    throw new Error(
      "Usage: run-branchmesh.mjs scan <selection> [options] | demo [--verify] [--output <directory>] | validate <result.json>",
    );
  } catch (error) {
    if (error instanceof SkillInterruptedError) return 130;
    throw error;
  } finally {
    signals.dispose();
  }
}

async function runScanWorkflow(options, contracts) {
  const cliArguments = selectionCliArguments(options);
  process.stderr.write("BranchMesh skill: running doctor before scan.\n");
  const doctor = await runProcess(process.execPath, [cliPath, "doctor", ...cliArguments], {
    cwd: options.repository,
    forward: true,
  });
  assertNotInterrupted();
  if (doctor.exitCode !== 0) {
    return normalizeExitCode(doctor.exitCode);
  }

  process.stderr.write("BranchMesh skill: doctor passed; running deterministic scan.\n");
  const scan = await runProcess(process.execPath, [cliPath, "scan", ...cliArguments], {
    cwd: options.repository,
    forward: true,
  });
  assertNotInterrupted();
  const scanExitCode = normalizeExitCode(scan.exitCode);
  if (!allowedCompletedScanCodes.has(scanExitCode)) {
    return scanExitCode;
  }

  const resultPath =
    options.output === null
      ? extractResultPath(scan.stdout)
      : path.join(path.resolve(options.repository, options.output), "result.json");
  const resultExists = await exists(resultPath);
  assertNotInterrupted();
  if (!resultExists) {
    return missingResultOutcome(scanExitCode);
  }

  const result = await readValidatedResult(resultPath, contracts.RunResultSchema);
  assertNotInterrupted();
  assertPublishedRedaction(result);
  assertScanProvenance(result, options, scanExitCode);
  await assertPublishedBundle(resultPath);
  assertNotInterrupted();
  writeEnvelope(createEnvelope(result, resultPath, scanExitCode));
  return 0;
}

async function runDemoWorkflow(options, contracts) {
  let verificationRoot = null;
  let verificationToken = null;
  let output = options.output;

  try {
    if (options.verify) {
      if (output !== null) {
        throw new Error("--verify and --output may not be combined");
      }
      const owned = await createOwnedVerificationRoot();
      verificationRoot = owned.root;
      verificationToken = owned.token;
      output = path.join(owned.root, "report");
      assertNotInterrupted();
    }

    const cliArguments = ["demo", "--json", ...(output === null ? [] : ["--output", output])];
    const demo = await runProcess(process.execPath, [cliPath, ...cliArguments], {
      cwd: projectRoot,
      forwardStderr: true,
    });
    assertNotInterrupted();
    const scanExitCode = normalizeExitCode(demo.exitCode);
    if (!allowedCompletedScanCodes.has(scanExitCode)) {
      return scanExitCode;
    }

    const demoEvidence = parseSingleJsonObject(demo.stdout, "demo output");
    const resultPath = requireString(demoEvidence.resultPath, "demo resultPath");
    if (output !== null) await assertDemoOutputPath(resultPath, output);
    const result = await readValidatedResult(resultPath, contracts.RunResultSchema);
    assertNotInterrupted();
    assertPublishedRedaction(result);
    assertScanProvenance(result, null, scanExitCode);
    await assertPublishedBundle(resultPath);
    assertNotInterrupted();
    if (options.verify) {
      assertDemoEvidence(result, demoEvidence);
    }
    writeEnvelope(createEnvelope(result, resultPath, scanExitCode, options.verify));
    return 0;
  } finally {
    if (verificationRoot !== null && verificationToken !== null) {
      await removeOwnedVerificationRoot(verificationRoot, verificationToken);
    }
    assertNotInterrupted();
  }
}

function parseScanArguments(arguments_) {
  let repository = process.cwd();
  let base = null;
  let output = null;
  let worktrees = false;
  let configured = false;
  const branches = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--worktrees") {
      worktrees = true;
    } else if (argument === "--configured") {
      configured = true;
    } else if (["--repository", "--base", "--branch", "--output"].includes(argument)) {
      const value = arguments_[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error(`${argument} requires a non-empty value`);
      }
      index += 1;
      if (argument === "--repository") repository = path.resolve(value);
      if (argument === "--base") base = assignOnce(base, value, argument);
      if (argument === "--output") output = assignOnce(output, value, argument);
      if (argument === "--branch") branches.push(value);
    } else if (argument === "--ignore-dirty") {
      throw new Error("The BranchMesh skill never permits --ignore-dirty");
    } else {
      throw new Error(`Unsupported skill argument: ${String(argument)}`);
    }
  }

  const modes = Number(worktrees) + Number(configured) + Number(branches.length > 0);
  if (modes !== 1) {
    throw new Error("Choose exactly one of --branch, --worktrees, or --configured");
  }
  if (branches.length > 0) {
    if (branches.length < 2 || branches.length > 5) {
      throw new Error("Named selection requires two to five --branch values");
    }
    if (new Set(branches).size !== branches.length) {
      throw new Error("Named branch references must be unique");
    }
    if (branches.some((branch) => branch.includes(","))) {
      throw new Error(
        "Branch references containing commas are unsupported by the CLI selection syntax",
      );
    }
    if (base !== null && branches.includes(base)) {
      throw new Error("The base reference may not also be a selected branch");
    }
  }

  return { repository, base, output, worktrees, configured, branches };
}

function parseDemoArguments(arguments_) {
  let verify = false;
  let output = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--verify") {
      verify = true;
    } else if (argument === "--output") {
      const value = arguments_[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("--output requires a non-empty value");
      }
      output = assignOnce(output, value, "--output");
      index += 1;
    } else {
      throw new Error(`Unsupported demo argument: ${String(argument)}`);
    }
  }
  return { verify, output };
}

function selectionCliArguments(options) {
  return [
    "--no-ignore-dirty",
    ...(options.base === null ? [] : ["--base", options.base]),
    ...(options.branches.length === 0 ? [] : ["--branches", options.branches.join(",")]),
    ...(options.worktrees ? ["--worktrees"] : []),
    ...(options.output === null ? [] : ["--output", options.output]),
  ];
}

async function readValidatedResult(resultPath, schema) {
  return schema.parse(await readJsonRegularFile(resultPath));
}

async function readJsonRegularFile(filePath) {
  const metadata = await lstat(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${filePath} must be a regular, non-symlink file`);
  }
  if (metadata.size > maximumResultBytes) {
    throw new Error(`${filePath} exceeds the skill's 256 MiB validation limit`);
  }

  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximumResultBytes) {
      throw new Error(`${filePath} is not a supported result file`);
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

function assertPublishedRedaction(result) {
  if (result.repositoryRoot !== "[redacted]" || result.commonGitDirectory !== "[redacted]") {
    throw new Error("Published result did not redact repository paths");
  }
  if (
    result.base.worktreePath !== null ||
    result.branches.some((branch) => branch.worktreePath !== null)
  ) {
    throw new Error("Published result contains a local worktree path");
  }
  if (result.base.dirty || result.branches.some((branch) => branch.dirty)) {
    throw new Error("The BranchMesh skill refuses results containing dirty selected worktrees");
  }
}

function assertScanProvenance(result, options, scanExitCode) {
  if (result.exitCode !== scanExitCode) {
    throw new Error(
      `CLI exit ${String(scanExitCode)} does not match result exit ${String(result.exitCode)}`,
    );
  }
  if (options === null) return;
  if (options.base !== null && result.base.ref !== options.base) {
    throw new Error("Published base does not match the requested base reference");
  }
  if (options.branches.length > 0) {
    const requested = [...options.branches].sort(compareText);
    const published = result.branches.map((branch) => branch.ref);
    if (
      requested.length !== published.length ||
      requested.some((reference, index) => reference !== published[index])
    ) {
      throw new Error("Published branches do not match the explicit skill selection");
    }
  }
}

async function assertPublishedBundle(resultPath) {
  const directory = path.dirname(resultPath);
  const html = await lstat(path.join(directory, "report.html"));
  const logs = await lstat(path.join(directory, "logs"));
  if (html.isSymbolicLink() || !html.isFile() || logs.isSymbolicLink() || !logs.isDirectory()) {
    throw new Error("Published report bundle is incomplete or contains symlinked evidence");
  }
}

function assertDemoEvidence(result, evidence) {
  const expectedRefs = ["feature/config-seconds", "feature/jitter", "feature/status-output"];
  const expectedConflictRefs = expectedRefs.slice(0, 2);
  const expectedPassingPairs = new Set([
    pairKey(expectedRefs[0], expectedRefs[2]),
    pairKey(expectedRefs[1], expectedRefs[2]),
  ]);
  const branches = result.jobs.filter((job) => job.kind === "branch");
  const pairs = result.jobs.filter((job) => job.kind === "pair");
  const conflict = pairs.find((job) => job.classification === "BEHAVIORAL_CONFLICT");
  const failedCommand =
    conflict?.failedCommandId === null || conflict?.failedCommandId === undefined
      ? undefined
      : conflict.commands.find((command) => command.id === conflict.failedCommandId);
  const snapshotsByRef = new Map(result.branches.map((branch) => [branch.ref, branch.sha]));
  const snapshotsMatch = [...branches, ...pairs].every(
    (job) =>
      job.branchRefs.length === job.branchShas.length &&
      job.branchRefs.every(
        (reference, index) => snapshotsByRef.get(reference) === job.branchShas[index],
      ),
  );
  if (
    result.exitCode !== 1 ||
    result.base.ref !== "main" ||
    !isFullCommitId(result.base.sha) ||
    result.jobs[0]?.classification !== "BASE_PASS" ||
    result.jobs[0]?.baseSha !== result.base.sha ||
    result.branches.map((branch) => branch.ref).join("\0") !== expectedRefs.join("\0") ||
    result.branches.some((branch) => !isFullCommitId(branch.sha)) ||
    branches.length !== 3 ||
    branches.some((job) => job.classification !== "BRANCH_PASS") ||
    pairs.length !== 3 ||
    pairs.filter((job) => job.classification === "BEHAVIORAL_CONFLICT").length !== 1 ||
    conflict?.branchRefs.join("\0") !== expectedConflictRefs.join("\0") ||
    conflict?.mergeOrder.join("\0") !== expectedConflictRefs.join("\0") ||
    conflict?.technicalClassification !== "PAIR_TEST_FAILURE" ||
    failedCommand?.id !== "test" ||
    failedCommand.kind !== "test" ||
    failedCommand.command !== "node --test" ||
    failedCommand.status !== "failed" ||
    new Set(
      pairs
        .filter((job) => job.classification === "NO_DETECTED_CONFLICT")
        .map((job) => pairKey(job.branchRefs[0], job.branchRefs[1])),
    ).size !== expectedPassingPairs.size ||
    pairs
      .filter((job) => job.classification === "NO_DETECTED_CONFLICT")
      .some((job) => !expectedPassingPairs.has(pairKey(job.branchRefs[0], job.branchRefs[1]))) ||
    !snapshotsMatch ||
    evidence.repositoryUnchanged !== true ||
    evidence.temporaryWorktreesRemaining !== 0
  ) {
    throw new Error("Deterministic demo evidence did not match the accepted hidden conflict");
  }
}

async function assertDemoOutputPath(resultPath, output) {
  const expectedDirectory = await realpath(path.resolve(projectRoot, output));
  const publishedDirectory = await realpath(path.dirname(resultPath));
  if (path.basename(resultPath) !== "result.json" || publishedDirectory !== expectedDirectory) {
    throw new Error("The deterministic demo result did not come from the requested output path");
  }
}

function createEnvelope(result, resultPath, scanExitCode, ephemeral = false) {
  const jobsByBranch = new Map(
    result.jobs.filter((job) => job.kind === "branch").map((job) => [job.branchRefs[0], job]),
  );
  return {
    validated: true,
    scanExitCode: scanExitCode ?? result.exitCode,
    schemaVersion: result.schemaVersion,
    runId: result.runId,
    resultPath: ephemeral ? null : resultPath,
    htmlPath: ephemeral ? null : path.join(path.dirname(resultPath), "report.html"),
    logsDirectory: ephemeral ? null : path.join(path.dirname(resultPath), "logs"),
    ephemeral,
    reportRetained: !ephemeral,
    base: summarizeJob(result.base, result.jobs[0]),
    branches: result.branches.map((branch) => summarizeJob(branch, jobsByBranch.get(branch.ref))),
    pairs: result.jobs.filter((job) => job.kind === "pair").map(summarizePair),
    summary: result.summary,
  };
}

function summarizeJob(snapshot, job) {
  return {
    ref: snapshot.ref,
    sha: snapshot.sha,
    classification: job?.classification ?? null,
    failedCommand: summarizeFailedCommand(job),
  };
}

function summarizePair(job) {
  return {
    refs: job.branchRefs,
    shas: job.branchShas,
    mergeOrder: job.mergeOrder,
    classification: job.classification,
    technicalClassification: job.technicalClassification,
    skipReason: job.skipReason,
    conflictedFiles: job.conflictedFiles,
    failedCommand: summarizeFailedCommand(job),
  };
}

function summarizeFailedCommand(job) {
  if (job?.failedCommandId === null || job?.failedCommandId === undefined) return null;
  const command = job.commands.find((candidate) => candidate.id === job.failedCommandId);
  if (command === undefined) return null;
  return {
    id: command.id,
    label: command.label,
    kind: command.kind,
    command: command.command,
    status: command.status,
    exitCode: command.exitCode,
    signal: command.signal,
    timedOut: command.timedOut,
    durationMs: command.durationMs,
    stdoutTruncated: command.stdout.truncated,
    stderrTruncated: command.stderr.truncated,
    evidence: {
      stdout: boundedEvidence(command.stdout.text),
      stderr: boundedEvidence(command.stderr.text),
    },
  };
}

function boundedEvidence(source) {
  if (source.length <= maximumEvidenceCharacters) return source;
  return `…${source.slice(-(maximumEvidenceCharacters - 1))}`;
}

function writeEnvelope(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

async function runProcess(command, arguments_, options) {
  if (interrupted) {
    return { exitCode: 130, signal: null, stdout: "", stderr: "" };
  }
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: childEnvironment(),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  activeChild = child;
  child.stdout.on("data", (chunk) => {
    stdout.push(chunk);
    if (options.forward) process.stderr.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk);
    if (options.forward || options.forwardStderr) process.stderr.write(chunk);
  });
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode: exitCode ?? (signal === null ? 2 : 130),
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  } finally {
    if (activeChild === child) activeChild = null;
  }
}

function installSignalForwarding() {
  interrupted = false;
  const onSigint = () => {
    interrupted = true;
    activeChild?.kill("SIGINT");
  };
  const onSigterm = () => {
    interrupted = true;
    activeChild?.kill("SIGTERM");
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return {
    dispose() {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      activeChild = null;
    },
  };
}

function assertNotInterrupted(interruptionObserved = interrupted) {
  if (interruptionObserved) throw new SkillInterruptedError();
}

function missingResultOutcome() {
  throw new Error("The completed scan's exact result.json is missing");
}

function childEnvironment() {
  const environment = { ...process.env };
  for (const variable of gitContextVariables) delete environment[variable];
  return environment;
}

function isFullCommitId(value) {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function pairKey(left, right) {
  return [left ?? "", right ?? ""].sort(compareText).join("\0");
}

function extractResultPath(stdout) {
  const paths = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("JSON: "))
    .map((line) => line.slice("JSON: ".length));
  if (paths.length !== 1 || paths[0] === undefined || !path.isAbsolute(paths[0])) {
    throw new Error("The scan did not emit one absolute result path");
  }
  return paths[0];
}

function parseSingleJsonObject(source, label) {
  try {
    const parsed = JSON.parse(source);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} was not one JSON object`);
  }
}

async function requireBuiltArtifact(candidate, label) {
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error();
  } catch {
    throw new Error(`BranchMesh ${label} is missing; run npm run build in ${projectRoot}`);
  }
}

async function createOwnedVerificationRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "branchmesh-skill-verify-"));
  const token = randomUUID();
  await writeFile(
    path.join(root, ".branchmesh-skill-verify.json"),
    `${JSON.stringify({ kind: "branchmesh-skill-verify", token })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return { root, token };
}

async function removeOwnedVerificationRoot(root, token) {
  const canonicalRoot = await realpath(root);
  const canonicalTemporaryRoot = await realpath(os.tmpdir());
  const metadata = await lstat(root);
  const marker = await readJsonRegularFile(path.join(root, ".branchmesh-skill-verify.json"));
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    path.dirname(canonicalRoot) !== canonicalTemporaryRoot ||
    path.basename(canonicalRoot).startsWith("branchmesh-skill-verify-") === false ||
    marker.kind !== "branchmesh-skill-verify" ||
    marker.token !== token
  ) {
    throw new Error("Refusing to remove an unverified skill-demo directory");
  }
  await rm(root, { recursive: true });
}

function assignOnce(current, value, option) {
  if (current !== null) throw new Error(`${option} may be provided only once`);
  return value;
}

function normalizeExitCode(exitCode) {
  return Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 2;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return false;
    throw error;
  }
}

export {
  assertDemoEvidence,
  assertNotInterrupted,
  createEnvelope,
  main,
  missingResultOutcome,
  parseScanArguments,
};
