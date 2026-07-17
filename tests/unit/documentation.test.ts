import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ScanConfigSchema } from "../../src/config/schema.js";
import {
  BaseClassificationSchema,
  BranchClassificationSchema,
  PairClassificationSchema,
  TechnicalClassificationSchema,
} from "../../src/model/results.js";

const documentationFiles = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/SAFETY_MODEL.md",
  "docs/CONFIGURATION.md",
  "docs/CLI_REFERENCE.md",
  "docs/CLASSIFICATIONS.md",
  "docs/SUPPORTED_PLATFORMS.md",
  "docs/LIMITATIONS.md",
  "docs/TROUBLESHOOTING.md",
  "docs/JUDGE_TESTING.md",
  "docs/SUBMISSION.md",
  "docs/VIDEO_SCRIPT.md",
  "docs/SCREENSHOT_CHECKLIST.md",
  "docs/DEMO_RECORDING_CHECKLIST.md",
  "docs/RELEASE_CHECKLIST.md",
] as const;

describe("Milestone 6 documentation", () => {
  it("ships every core guide without TODOs or personal absolute paths", async () => {
    for (const file of documentationFiles) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/\bTODO\b/u);
      expect(source, file).not.toMatch(/\/Users\/[A-Za-z0-9._-]+\//u);
    }
  });

  it("keeps README local links valid", async () => {
    const source = await readFile("README.md", "utf8");
    expect(source).not.toContain("<branchmesh-repository>");
    const links = [...source.matchAll(/\[[^\]]+\]\((?<target>[^)]+)\)/gu)]
      .map((match) => match.groups?.["target"])
      .filter((target): target is string => target !== undefined && !target.includes("://"));

    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      await expect(access(path.resolve(link))).resolves.toBeUndefined();
    }
  });

  it("keeps packed-install instructions aligned with the package version", async () => {
    const readme = await readFile("README.md", "utf8");
    const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as {
      version?: unknown;
    };

    expect(typeof packageManifest.version).toBe("string");
    expect(readme).toContain(`branchmesh-${String(packageManifest.version)}.tgz`);
  });

  it("keeps documented configuration examples aligned with the Zod contract", async () => {
    for (const file of ["README.md", "docs/CONFIGURATION.md"] as const) {
      const source = await readFile(file, "utf8");
      const block = /```json\n(?<json>[\s\S]*?)\n```/u.exec(source)?.groups?.["json"];
      expect(block, file).toBeDefined();
      expect(() => ScanConfigSchema.parse(JSON.parse(block ?? "null")), file).not.toThrow();
    }
  });

  it("documents every stable classification", async () => {
    const source = await readFile("docs/CLASSIFICATIONS.md", "utf8");
    const classifications = [
      ...BaseClassificationSchema.options,
      ...BranchClassificationSchema.options,
      ...PairClassificationSchema.options,
      ...TechnicalClassificationSchema.options,
    ];

    for (const classification of classifications) {
      expect(source).toContain(`\`${classification}\``);
    }
    expect(source).toContain("No detected conflict");
    expect(source).not.toContain("Guaranteed safe");
  });
});
