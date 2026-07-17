import pc from "picocolors";

import type { ScanProgressEvent } from "../engine/runScan.js";
import { RunResultSchema, type JobResult, type RunResult } from "../model/results.js";
import {
  classificationTone,
  primaryClassificationLabel,
  technicalClassificationLabel,
  type ClassificationTone,
} from "../report/classifications.js";

export interface TerminalReportLocations {
  readonly resultPath: string;
  readonly htmlPath: string;
  readonly logsDirectory: string;
}

export type TerminalWriter = (text: string) => void;

export function createTerminalProgressReporter(
  write: TerminalWriter,
): (event: ScanProgressEvent) => void {
  return (event) => {
    switch (event.type) {
      case "scan-started":
        write(
          `${pc.bold("SCAN")} Base ${event.baseRef}; ${String(event.branchRefs.length)} branches snapshotted (${event.repositoryFingerprint})\n`,
        );
        return;
      case "job-started":
        write(`${pc.cyan("RUN ")} ${jobDisplayName(event.kind, event.branchRefs)}\n`);
        return;
      case "job-completed":
        write(
          `${toneLabel(classificationTone(event.classification))} ${jobDisplayName(event.kind, event.branchRefs)} — ${primaryClassificationLabel(event.classification)} [${event.classification}] (${formatDuration(event.durationMs)})\n`,
        );
        return;
      case "report-publishing":
        write(`${pc.cyan("SAVE")} Publishing validated reports to ${event.outputDirectory}\n`);
        return;
      case "report-published":
        write(`${pc.green("DONE")} JSON and offline HTML reports published\n`);
        return;
    }
  };
}

export function renderTerminalSummary(
  input: RunResult,
  locations: TerminalReportLocations,
): string {
  const result = RunResultSchema.parse(input);
  const baseJob = result.jobs.find((job) => job.kind === "base");
  const branchJobs = result.jobs.filter((job) => job.kind === "branch");
  const pairJobs = result.jobs.filter((job) => job.kind === "pair");

  return [
    "",
    pc.bold(pc.cyan("BranchMesh compatibility summary")),
    `Base: ${baseJob === undefined ? "Not executed" : formatClassification(baseJob)}`,
    "",
    pc.bold("Individual branches"),
    ...result.branches.map((branch, index) => {
      const job = branchJobs[index];
      return `[${String(index + 1)}] ${branch.ref} @ ${shortSha(branch.sha)} — ${job === undefined ? "Not executed" : formatClassification(job)}`;
    }),
    "",
    pc.bold("Compatibility matrix"),
    renderCompatibilityMatrix(result, pairJobs),
    "Legend: OK = No detected conflict; BC = Behavioral conflict; GC = Textual Git conflict; SKIP = Pair skipped; — = same branch",
    "",
    ...pairJobs.map(
      (job) =>
        `${job.branchRefs.join(" + ")} — ${formatClassification(job)}${job.technicalClassification === null ? "" : `; ${technicalClassificationLabel(job.technicalClassification)} [${job.technicalClassification}]`}`,
    ),
    "",
    pc.bold("Counts"),
    `Branches: ${String(result.summary.passedBranches)} passed, ${String(result.summary.failedBranches)} failed`,
    `Pairs: ${String(result.summary.passedPairs)} no detected conflict, ${String(result.summary.behavioralConflicts)} behavioral conflict, ${String(result.summary.textualConflicts)} textual Git conflict, ${String(result.summary.skippedPairs)} skipped`,
    "",
    pc.bold("Reports"),
    `JSON: ${locations.resultPath}`,
    `HTML: ${locations.htmlPath}`,
    `Raw logs: ${locations.logsDirectory}`,
  ].join("\n");
}

function renderCompatibilityMatrix(result: RunResult, pairJobs: readonly JobResult[]): string {
  const pairMap = new Map(
    pairJobs.map((job) => [pairKey(job.branchRefs[0] ?? "", job.branchRefs[1] ?? ""), job]),
  );
  const cellWidth = 6;
  const header = [
    " ".repeat(cellWidth),
    ...result.branches.map((_branch, index) => `[${String(index + 1)}]`.padStart(cellWidth)),
  ].join("");
  const rows = result.branches.map((row, rowIndex) => {
    const cells = result.branches.map((column, columnIndex) => {
      if (rowIndex === columnIndex) {
        return "—".padStart(cellWidth);
      }
      const job = pairMap.get(pairKey(row.ref, column.ref));
      return matrixCode(job).padStart(cellWidth);
    });
    return [`[${String(rowIndex + 1)}]`.padEnd(cellWidth), ...cells].join("");
  });
  return [header, ...rows].join("\n");
}

function matrixCode(job: JobResult | undefined): string {
  if (job === undefined) {
    return "N/R";
  }
  switch (job.classification) {
    case "NO_DETECTED_CONFLICT":
      return pc.green("OK");
    case "BEHAVIORAL_CONFLICT":
      return pc.red("BC");
    case "TEXTUAL_CONFLICT":
      return pc.yellow("GC");
    case "PAIR_SKIPPED":
      return pc.gray("SKIP");
    default:
      return "N/R";
  }
}

function formatClassification(job: JobResult): string {
  const label = `${primaryClassificationLabel(job.classification)} [${job.classification}]`;
  return colorForTone(classificationTone(job.classification), label);
}

function toneLabel(tone: ClassificationTone): string {
  const label =
    tone === "pass" ? "PASS" : tone === "fail" ? "FAIL" : tone === "warning" ? "WARN" : "SKIP";
  return colorForTone(tone, label.padEnd(4));
}

function colorForTone(tone: ClassificationTone, value: string): string {
  return tone === "pass"
    ? pc.green(value)
    : tone === "fail"
      ? pc.red(value)
      : tone === "warning"
        ? pc.yellow(value)
        : pc.gray(value);
}

function jobDisplayName(kind: "base" | "branch" | "pair", branchRefs: readonly string[]): string {
  return kind === "base"
    ? "Base validation"
    : kind === "branch"
      ? `Branch ${branchRefs[0] ?? "unknown"}`
      : `Pair ${branchRefs.join(" + ")}`;
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${String(durationMs)} ms` : `${(durationMs / 1_000).toFixed(2)} s`;
}
