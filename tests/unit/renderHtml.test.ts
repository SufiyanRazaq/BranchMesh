import { describe, expect, it } from "vitest";

import { createReportFixture } from "../helpers/reportFixture.js";
import { createReportProjection } from "../../src/report/projection.js";
import { renderOfflineHtml } from "../../src/report/renderHtml.js";
import { ReportProjectionSchema } from "../../src/report/schema.js";

describe("offline HTML report", () => {
  it("renders hostile text safely with no external runtime dependencies", () => {
    const hostile = '</script><img src=x onerror="globalThis.pwned=true"> سلام 😀 &';
    const result = createReportFixture({
      branchRefs: ['feature/quote"&branch', "feature/یونیکوڈ"],
      commandLabel: hostile,
      command: `node -e ${JSON.stringify(hostile)}`,
      stdout: `\u001b[32m${hostile}\u001b[0m`,
      stderr: "<b>stderr evidence</b>",
    });
    const projection = createReportProjection(result, { environment: {} });
    const html = renderOfflineHtml(projection);
    const embedded = extractEmbeddedProjection(html);

    expect(ReportProjectionSchema.parse(embedded)).toEqual(projection);
    expect(html.match(/<\/script>/gu)).toHaveLength(2);
    expect(html).not.toContain('<img src=x onerror="globalThis.pwned=true">');
    expect(html).toContain("&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;");
    expect(html).toContain("سلام 😀");
    expect(html).not.toContain("\u001b");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/(?:src|href)=["']https?:/iu);
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("React");
    expect(html).not.toContain("Vue");
  });

  it("includes accessible evidence, limitations, responsive, and print views", () => {
    const html = renderOfflineHtml(
      createReportProjection(createReportFixture(), { environment: {} }),
    );

    expect(html).toContain("Summary");
    expect(html).toContain("Compatibility matrix");
    expect(html).toContain("No detected conflict");
    expect(html).toContain('class="matrix-cell');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-controls="detail-pair-0-1"');
    expect(html).toContain("Command evidence");
    expect(html).toContain("Reproduction information");
    expect(html).toContain("Limitations");
    expect(html).toContain("@media (max-width: 900px)");
    expect(html).toContain("@media print");
    expect(html).not.toContain("Guaranteed safe");
  });
});

function extractEmbeddedProjection(html: string): unknown {
  const match = html.match(
    /<script id="branchmesh-report-data" type="application\/json">(?<json>.*?)<\/script>/su,
  );
  if (match?.groups?.["json"] === undefined) {
    throw new Error("Report projection script was not found");
  }
  return JSON.parse(match.groups["json"]);
}
