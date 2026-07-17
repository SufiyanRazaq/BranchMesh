import {
  classificationTone,
  primaryClassificationLabel,
  technicalClassificationLabel,
} from "./classifications.js";
import {
  ReportProjectionSchema,
  type ReportCommand,
  type ReportJob,
  type ReportProjection,
} from "./schema.js";

export function renderOfflineHtml(input: ReportProjection): string {
  const report = ReportProjectionSchema.parse(input);
  const baseJob = report.jobs.find((job) => job.kind === "base");
  const branchJobs = report.jobs.filter((job) => job.kind === "branch");
  const pairJobs = report.jobs.filter((job) => job.kind === "pair");
  const pairByReferences = new Map(
    pairJobs.map((job) => [pairKey(job.branchRefs[0] ?? "", job.branchRefs[1] ?? ""), job]),
  );
  const defaultJob =
    pairJobs.find(
      (job) =>
        job.classification === "BEHAVIORAL_CONFLICT" || job.classification === "TEXTUAL_CONFLICT",
    ) ??
    pairJobs[0] ??
    branchJobs[0] ??
    baseJob;
  const defaultJobId = defaultJob?.id ?? "base";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>BranchMesh compatibility report</title>
  <style>${reportStyles}</style>
</head>
<body>
  <a class="skip-link" href="#report-main">Skip to report</a>
  <header class="site-header">
    <div>
      <p class="eyebrow">BranchMesh compatibility report</p>
      <h1>Committed branch compatibility</h1>
      <p class="subtitle">Repository ${escapeHtml(report.repositoryFingerprint)} · base ${escapeHtml(report.base.ref)} at <code>${escapeHtml(shortSha(report.base.sha))}</code></p>
    </div>
    <div class="run-meta" aria-label="Run metadata">
      <span>Run <code>${escapeHtml(report.runId)}</code></span>
      <span>${escapeHtml(formatDuration(report.durationMs))}</span>
      <span>${escapeHtml(report.completedAt)}</span>
    </div>
  </header>

  <main id="report-main">
    <section aria-labelledby="summary-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Observed result</p>
          <h2 id="summary-heading">Summary</h2>
        </div>
        ${renderBaseStatus(baseJob)}
      </div>
      <div class="summary-grid">
        ${summaryCard("Branches selected", report.summary.branchCount)}
        ${summaryCard("Pairs planned", report.summary.pairCount)}
        ${summaryCard("No detected conflict", report.summary.passedPairs, "pass")}
        ${summaryCard("Behavioral conflicts", report.summary.behavioralConflicts, "fail")}
        ${summaryCard("Textual Git conflicts", report.summary.textualConflicts, "warning")}
        ${summaryCard("Pairs skipped", report.summary.skippedPairs, "skipped")}
      </div>
    </section>

    <section aria-labelledby="branches-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Individual evidence</p>
          <h2 id="branches-heading">Branch statuses</h2>
        </div>
      </div>
      <ul class="branch-status-list">
        ${report.branches
          .map((branch, index) => renderBranchStatus(branch.ref, branch.sha, branchJobs[index]))
          .join("\n")}
      </ul>
    </section>

    <section aria-labelledby="matrix-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Pairwise evidence</p>
          <h2 id="matrix-heading">Compatibility matrix</h2>
        </div>
        <p class="section-note">Every cell includes a text label; color is supplementary.</p>
      </div>
      ${renderMatrix(report, pairByReferences, defaultJobId)}
      <ul class="matrix-key" aria-label="Branch key">
        ${report.branches
          .map(
            (branch, index) =>
              `<li><strong>[${String(index + 1)}]</strong> ${escapeHtml(branch.ref)} <code>${escapeHtml(shortSha(branch.sha))}</code></li>`,
          )
          .join("\n")}
      </ul>
      <div class="legend" aria-label="Compatibility status legend">
        ${legendItem("pass", "No detected conflict")}
        ${legendItem("fail", "Behavioral conflict")}
        ${legendItem("warning", "Textual Git conflict")}
        ${legendItem("skipped", "Pair skipped")}
      </div>
    </section>

    <section class="report-layout" aria-labelledby="evidence-heading">
      <div>
        <p class="eyebrow">Snapshots</p>
        <h2>Branch details</h2>
        <div class="branch-details">
          ${report.branches.map(renderBranchDetail).join("\n")}
        </div>
      </div>
      <aside id="evidence-drawer" class="evidence-drawer" aria-labelledby="evidence-heading" aria-live="polite">
        <div class="drawer-heading">
          <div>
            <p class="eyebrow">Selected evidence</p>
            <h2 id="evidence-heading">Job details</h2>
          </div>
          <button id="close-evidence" class="secondary-button" type="button">Close details</button>
        </div>
        ${report.jobs.map((job) => renderJobDetail(job, job.id === defaultJobId)).join("\n")}
      </aside>
    </section>

    <section class="limitations" aria-labelledby="limitations-heading">
      <p class="eyebrow">Evidence boundary</p>
      <h2 id="limitations-heading">Limitations</h2>
      <p>BranchMesh detects incompatibilities observable through the configured commands. Passing combinations may still contain defects not covered by those checks.</p>
      <p>This report covers committed branch tips and pairwise combinations in the displayed merge order. It does not include uncommitted worktree content or reverse merge-order testing.</p>
    </section>
  </main>

  <footer>
    <p>Generated locally by BranchMesh ${escapeHtml(report.toolVersion)}. This file contains no external assets or runtime network requests.</p>
  </footer>

  <script id="branchmesh-report-data" type="application/json">${serializeForScript(report)}</script>
  <script>${reportBehavior}</script>
</body>
</html>
`;
}

function renderBaseStatus(baseJob: ReportJob | undefined): string {
  if (baseJob === undefined) {
    return `<span class="status-badge status-skipped">Not executed</span>`;
  }
  return statusBadge(baseJob.classification);
}

function summaryCard(
  label: string,
  value: number,
  tone: "pass" | "fail" | "warning" | "skipped" | "neutral" = "neutral",
): string {
  return `<article class="summary-card summary-${tone}"><strong>${String(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function renderBranchStatus(ref: string, sha: string, job: ReportJob | undefined): string {
  if (job === undefined) {
    return `<li><div><strong>${escapeHtml(ref)}</strong><code>${escapeHtml(shortSha(sha))}</code></div><span class="status-badge status-skipped">Not executed</span></li>`;
  }
  return `<li><div><strong>${escapeHtml(ref)}</strong><code>${escapeHtml(shortSha(sha))}</code></div><button class="job-link" type="button" data-job-target="${escapeAttribute(job.id)}" aria-controls="detail-${escapeAttribute(job.id)}" aria-expanded="false">${statusBadge(job.classification)}<span class="visually-hidden">; show details for ${escapeHtml(ref)}</span></button></li>`;
}

function renderMatrix(
  report: ReportProjection,
  pairByReferences: ReadonlyMap<string, ReportJob>,
  defaultJobId: string,
): string {
  const header = report.branches
    .map(
      (branch, index) =>
        `<th scope="col" title="${escapeAttribute(branch.ref)}"><span aria-hidden="true">[${String(index + 1)}]</span><span class="visually-hidden">${escapeHtml(branch.ref)}</span></th>`,
    )
    .join("\n");
  const rows = report.branches
    .map((rowBranch, rowIndex) => {
      const cells = report.branches
        .map((columnBranch, columnIndex) => {
          if (rowIndex === columnIndex) {
            return `<td><span class="matrix-na" aria-label="${escapeAttribute(rowBranch.ref)} with itself: not applicable">—</span></td>`;
          }
          const job = pairByReferences.get(pairKey(rowBranch.ref, columnBranch.ref));
          if (job === undefined) {
            return `<td><span class="matrix-not-run" aria-label="${escapeAttribute(rowBranch.ref)} with ${escapeAttribute(columnBranch.ref)}: not executed">Not run</span></td>`;
          }
          const label = primaryClassificationLabel(job.classification);
          const tone = classificationTone(job.classification);
          return `<td><button class="matrix-cell status-${tone}" type="button" data-job-target="${escapeAttribute(job.id)}" aria-controls="detail-${escapeAttribute(job.id)}" aria-expanded="${job.id === defaultJobId ? "true" : "false"}" aria-label="${escapeAttribute(`${rowBranch.ref} with ${columnBranch.ref}: ${label}`)}"><span aria-hidden="true">${escapeHtml(matrixSymbol(tone))}</span><span>${escapeHtml(label)}</span></button></td>`;
        })
        .join("\n");
      return `<tr><th scope="row" title="${escapeAttribute(rowBranch.ref)}"><span aria-hidden="true">[${String(rowIndex + 1)}]</span><span class="visually-hidden">${escapeHtml(rowBranch.ref)}</span></th>${cells}</tr>`;
    })
    .join("\n");
  return `<div class="matrix-scroll" tabindex="0" aria-label="Scrollable compatibility matrix"><table class="compatibility-matrix"><caption>Pairwise compatibility for ${String(report.branches.length)} snapshotted branches</caption><thead><tr><th scope="col">Branch</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderBranchDetail(branch: ReportProjection["branches"][number]): string {
  return `<details><summary>${escapeHtml(branch.ref)}</summary><dl class="metadata"><div><dt>Commit</dt><dd><code>${escapeHtml(branch.sha)}</code></dd></div><div><dt>Selected worktree dirty</dt><dd>${branch.dirty ? "Yes; committed SHA only" : "No"}</dd></div></dl><h3>Changed files</h3>${renderStringList(branch.changedFiles, "No changed files were reported.")}</details>`;
}

function renderJobDetail(job: ReportJob, visible: boolean): string {
  const title =
    job.kind === "base"
      ? "Base validation"
      : job.kind === "branch"
        ? (job.branchRefs[0] ?? "Branch validation")
        : job.branchRefs.join(" + ");
  const technical =
    job.technicalClassification === null
      ? ""
      : `<span class="technical-label">${escapeHtml(technicalClassificationLabel(job.technicalClassification))} · <code>${escapeHtml(job.technicalClassification)}</code></span>`;
  return `<article id="detail-${escapeAttribute(job.id)}" class="job-detail" data-job-panel="${escapeAttribute(job.id)}"${visible ? "" : " hidden"} tabindex="-1">
    <div class="job-title"><div><p class="eyebrow">${escapeHtml(job.kind)} job</p><h3>${escapeHtml(title)}</h3></div>${statusBadge(job.classification)}</div>
    ${technical}
    <dl class="metadata">
      <div><dt>Classification</dt><dd><code>${escapeHtml(job.classification)}</code></dd></div>
      <div><dt>Duration</dt><dd>${escapeHtml(formatDuration(job.durationMs))}</dd></div>
      <div><dt>Base SHA</dt><dd><code>${escapeHtml(job.baseSha)}</code></dd></div>
      <div><dt>Merge order</dt><dd>${job.mergeOrder.length === 0 ? "Base only" : escapeHtml(job.mergeOrder.join(" → "))}</dd></div>
    </dl>
    ${job.skipReason === null ? "" : `<p><strong>Skip reason:</strong> <code>${escapeHtml(job.skipReason)}</code></p>`}
    ${job.conflictedFiles.length === 0 ? "" : `<h4>Conflicted files</h4>${renderStringList(job.conflictedFiles, "")}`}
    <h4>Command evidence</h4>
    ${job.commands.length === 0 ? `<p class="empty-state">No commands executed for this job.</p>` : job.commands.map(renderCommand).join("\n")}
    <h4>Reproduction information</h4>
    ${renderReproduction(job)}
  </article>`;
}

function renderCommand(command: ReportCommand): string {
  const exitDescription =
    command.exitCode === null ? "No exit code" : `Exit code ${String(command.exitCode)}`;
  const signalDescription = command.signal === null ? "No signal" : `Signal ${command.signal}`;
  return `<details class="command-evidence"${command.status === "passed" ? "" : " open"}>
    <summary><span>${escapeHtml(command.label)}</span><span class="command-status command-${escapeAttribute(command.status)}">${escapeHtml(command.status.replaceAll("_", " "))}</span></summary>
    <dl class="metadata compact"><div><dt>Kind</dt><dd>${escapeHtml(command.kind)}</dd></div><div><dt>Duration</dt><dd>${escapeHtml(formatDuration(command.durationMs))}</dd></div><div><dt>Process</dt><dd>${escapeHtml(`${exitDescription}; ${signalDescription}`)}</dd></div><div><dt>Timeout</dt><dd>${command.timedOut ? "Yes" : `No (${String(command.timeoutMs)} ms limit)`}</dd></div></dl>
    <p><strong>Command</strong></p><pre><code>${escapeHtml(command.command)}</code></pre>
    <div class="stream-grid">
      ${renderStream("stdout", command.stdout.text, command.stdout.truncated, command.stdoutLogPath)}
      ${renderStream("stderr", command.stderr.text, command.stderr.truncated, command.stderrLogPath)}
    </div>
  </details>`;
}

function renderStream(
  label: "stdout" | "stderr",
  text: string,
  truncated: boolean,
  logPath: string,
): string {
  return `<section class="stream"><h5>${label}</h5><p class="log-meta">${truncated ? "Embedded evidence truncated" : "Embedded evidence complete"} · raw log <code>${escapeHtml(logPath)}</code></p><pre><code>${escapeHtml(text.length === 0 ? "(no output)" : text)}</code></pre></section>`;
}

function renderReproduction(job: ReportJob): string {
  const steps = [
    `<li>Create a disposable detached worktree at base <code>${escapeHtml(job.reproduction.baseSha)}</code>.</li>`,
    ...job.reproduction.mergeShas.map(
      (sha, index) =>
        `<li>Merge captured commit <code>${escapeHtml(sha)}</code>${job.reproduction.mergeOrder[index] === undefined ? "" : ` for ${escapeHtml(job.reproduction.mergeOrder[index] ?? "")}`} in the displayed order.</li>`,
    ),
    ...job.reproduction.commands.map(
      (command) => `<li>Run <code>${escapeHtml(command)}</code> in that temporary worktree.</li>`,
    ),
  ];
  if (job.reproduction.commands.length === 0) {
    steps.push("<li>No project command ran because the job was conflicted or skipped.</li>");
  }
  return `<ol class="reproduction">${steps.join("\n")}</ol>`;
}

function renderStringList(values: readonly string[], emptyText: string): string {
  if (values.length === 0) {
    return `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
  }
  return `<ul class="file-list">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join("\n")}</ul>`;
}

function statusBadge(classification: ReportJob["classification"]): string {
  const tone = classificationTone(classification);
  return `<span class="status-badge status-${tone}">${escapeHtml(primaryClassificationLabel(classification))}</span>`;
}

function legendItem(tone: "pass" | "fail" | "warning" | "skipped", label: string): string {
  return `<span><span class="legend-swatch status-${tone}" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function matrixSymbol(tone: "pass" | "fail" | "warning" | "skipped"): string {
  return tone === "pass" ? "✓" : tone === "fail" ? "✕" : tone === "warning" ? "⚠" : "○";
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

function serializeForScript(value: ReportProjection): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

const reportBehavior = `(() => {
  "use strict";
  const drawer = document.getElementById("evidence-drawer");
  const closeButton = document.getElementById("close-evidence");
  const buttons = Array.from(document.querySelectorAll("[data-job-target]"));
  const panels = Array.from(document.querySelectorAll("[data-job-panel]"));

  function showJob(jobId, focusPanel) {
    drawer.hidden = false;
    for (const panel of panels) {
      const selected = panel.dataset.jobPanel === jobId;
      panel.hidden = !selected;
      if (selected && focusPanel) panel.focus();
    }
    for (const button of buttons) {
      button.setAttribute("aria-expanded", String(button.dataset.jobTarget === jobId));
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => showJob(button.dataset.jobTarget, true));
  }

  closeButton.addEventListener("click", () => {
    drawer.hidden = true;
    for (const button of buttons) button.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) closeButton.click();
  });
})();`;

const reportStyles = `
:root {
  color-scheme: light dark;
  --bg: #0d1117;
  --panel: #161b22;
  --panel-strong: #1f2630;
  --text: #f0f3f6;
  --muted: #a7b0bc;
  --border: #3a4552;
  --accent: #79c0ff;
  --pass: #3fb950;
  --fail: #ff7b72;
  --warning: #d29922;
  --skipped: #8b949e;
  --shadow: 0 16px 40px rgb(0 0 0 / 0.22);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); line-height: 1.5; }
body { margin: 0; min-width: 320px; }
button, code, pre { font: inherit; }
code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
code { overflow-wrap: anywhere; }
a { color: var(--accent); }
.skip-link { position: absolute; left: 1rem; top: -5rem; padding: .7rem 1rem; background: var(--text); color: var(--bg); z-index: 10; }
.skip-link:focus { top: 1rem; }
.site-header, main, footer { width: min(1180px, calc(100% - 2rem)); margin-inline: auto; }
.site-header { display: flex; justify-content: space-between; gap: 2rem; padding: 3rem 0 2rem; border-bottom: 1px solid var(--border); }
h1, h2, h3, h4, h5, p { margin-top: 0; }
h1 { max-width: 14ch; margin-bottom: .6rem; font-size: clamp(2rem, 6vw, 4.4rem); line-height: .96; letter-spacing: -.045em; }
h2 { margin-bottom: .5rem; font-size: clamp(1.45rem, 3vw, 2rem); }
h3 { margin-bottom: .35rem; }
h4 { margin-top: 1.5rem; margin-bottom: .65rem; }
h5 { margin-bottom: .35rem; text-transform: uppercase; letter-spacing: .06em; }
.eyebrow { margin-bottom: .35rem; color: var(--accent); font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.subtitle, .section-note, .log-meta, footer { color: var(--muted); }
.run-meta { display: flex; flex-direction: column; align-items: flex-end; gap: .35rem; color: var(--muted); text-align: right; }
main { display: grid; gap: 3.5rem; padding: 3rem 0; }
.section-heading, .drawer-heading, .job-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.summary-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .8rem; }
.summary-card { display: flex; min-height: 8.5rem; flex-direction: column; justify-content: space-between; padding: 1rem; border: 1px solid var(--border); border-radius: .8rem; background: var(--panel); }
.summary-card strong { font-size: 2.4rem; line-height: 1; }
.summary-card span { color: var(--muted); font-weight: 700; }
.summary-pass { border-top: 4px solid var(--pass); }
.summary-fail { border-top: 4px solid var(--fail); }
.summary-warning { border-top: 4px solid var(--warning); }
.summary-skipped { border-top: 4px solid var(--skipped); }
.branch-status-list, .matrix-key, .file-list { margin: 0; padding: 0; list-style: none; }
.branch-status-list { display: grid; gap: .6rem; }
.branch-status-list li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .85rem 1rem; border: 1px solid var(--border); border-radius: .65rem; background: var(--panel); }
.branch-status-list li > div { display: flex; min-width: 0; flex-direction: column; }
.job-link { border: 0; background: transparent; color: inherit; cursor: pointer; }
.matrix-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: .8rem; background: var(--panel); box-shadow: var(--shadow); }
.matrix-scroll:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.compatibility-matrix { width: 100%; min-width: 690px; border-collapse: collapse; }
.compatibility-matrix caption { padding: 1rem; color: var(--muted); text-align: left; }
.compatibility-matrix th, .compatibility-matrix td { min-width: 8rem; padding: .65rem; border-top: 1px solid var(--border); border-right: 1px solid var(--border); text-align: center; }
.compatibility-matrix th { min-width: 5.5rem; background: var(--panel-strong); }
.matrix-cell { display: grid; width: 100%; min-height: 5rem; place-items: center; gap: .2rem; padding: .55rem; border: 2px solid transparent; border-radius: .55rem; color: var(--text); cursor: pointer; font-size: .78rem; font-weight: 800; }
.matrix-cell span:first-child { font-size: 1.25rem; }
.matrix-cell:focus-visible, .job-link:focus-visible, .secondary-button:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.matrix-na, .matrix-not-run { color: var(--muted); }
.matrix-key { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .4rem 1rem; margin-top: 1rem; }
.legend { display: flex; flex-wrap: wrap; gap: .8rem 1.2rem; margin-top: 1rem; color: var(--muted); }
.legend > span { display: inline-flex; align-items: center; gap: .45rem; }
.legend-swatch { width: .85rem; height: .85rem; border-radius: 50%; }
.status-badge { display: inline-flex; width: fit-content; align-items: center; padding: .26rem .55rem; border: 1px solid currentColor; border-radius: 999px; font-size: .78rem; font-weight: 850; }
.status-pass { background: color-mix(in srgb, var(--pass) 18%, var(--panel)); color: #7ee787; }
.status-fail { background: color-mix(in srgb, var(--fail) 18%, var(--panel)); color: #ffa198; }
.status-warning { background: color-mix(in srgb, var(--warning) 20%, var(--panel)); color: #e3b341; }
.status-skipped { background: color-mix(in srgb, var(--skipped) 18%, var(--panel)); color: #c9d1d9; }
.report-layout { display: grid; grid-template-columns: minmax(15rem, .75fr) minmax(0, 1.5fr); gap: 1.2rem; align-items: start; }
.branch-details { display: grid; gap: .7rem; }
.branch-details details, .command-evidence { border: 1px solid var(--border); border-radius: .65rem; background: var(--panel); }
summary { padding: .8rem 1rem; cursor: pointer; font-weight: 800; }
.branch-details details > :not(summary) { margin-inline: 1rem; }
.evidence-drawer { min-width: 0; padding: 1.2rem; border: 1px solid var(--border); border-radius: .8rem; background: var(--panel-strong); box-shadow: var(--shadow); }
.secondary-button { padding: .5rem .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--panel); color: var(--text); cursor: pointer; }
.job-detail[hidden], .evidence-drawer[hidden] { display: none; }
.technical-label { display: inline-block; margin-bottom: 1rem; color: var(--muted); }
.metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; margin: 1rem 0; }
.metadata div { min-width: 0; padding: .65rem; border-left: 3px solid var(--border); background: var(--panel); }
.metadata dt { color: var(--muted); font-size: .78rem; font-weight: 750; text-transform: uppercase; }
.metadata dd { margin: .2rem 0 0; overflow-wrap: anywhere; }
.metadata.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.command-evidence { margin-top: .75rem; overflow: hidden; }
.command-evidence > summary { display: flex; justify-content: space-between; gap: 1rem; background: var(--panel); }
.command-evidence > :not(summary) { margin-inline: 1rem; }
.command-status { color: var(--muted); text-transform: capitalize; }
.command-failed, .command-timed_out { color: var(--fail); }
pre { max-height: 22rem; overflow: auto; margin: .5rem 0 1rem; padding: .8rem; border: 1px solid var(--border); border-radius: .45rem; background: #080b10; color: #f0f3f6; white-space: pre-wrap; overflow-wrap: anywhere; }
.stream-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
.log-meta { margin-bottom: .35rem; font-size: .78rem; }
.reproduction { padding-left: 1.3rem; }
.reproduction li + li { margin-top: .4rem; }
.file-list { display: grid; gap: .25rem; }
.empty-state { color: var(--muted); font-style: italic; }
.limitations { padding: 1.25rem; border-left: 5px solid var(--warning); background: var(--panel); }
footer { padding: 0 0 3rem; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@media (max-width: 900px) {
  .site-header, .section-heading { flex-direction: column; }
  .run-meta { align-items: flex-start; text-align: left; }
  .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .report-layout { grid-template-columns: 1fr; }
  .metadata.compact, .stream-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .branch-status-list li, .drawer-heading, .job-title { align-items: flex-start; flex-direction: column; }
  .metadata { grid-template-columns: 1fr; }
}
@media print {
  :root { color-scheme: light; --bg: #fff; --panel: #fff; --panel-strong: #fff; --text: #111; --muted: #444; --border: #888; --shadow: none; }
  .site-header, main, footer { width: 100%; }
  .matrix-scroll { overflow: visible; box-shadow: none; }
  .compatibility-matrix { min-width: 0; font-size: 8pt; }
  .matrix-cell { min-height: 0; color: #111; }
  .secondary-button { display: none; }
  .evidence-drawer[hidden], .job-detail[hidden] { display: block; }
  .job-detail { break-inside: avoid; margin-top: 1rem; }
  pre { max-height: none; white-space: pre-wrap; }
}
`;
