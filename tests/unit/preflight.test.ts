import { describe, expect, it } from "vitest";

import {
  parseGitVersion,
  validateGitVersion,
  validateNodeVersion,
} from "../../src/git/RepositoryInspector.js";

describe("runtime preflight versions", () => {
  it("parses standard and vendor-suffixed Git versions", () => {
    expect(parseGitVersion("git version 2.45.2").version).toBe("2.45.2");
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)").version).toBe("2.39.5");
  });

  it("requires Node.js 20 or newer", () => {
    expect(() => validateNodeVersion("20.0.0")).not.toThrow();
    expect(() => validateNodeVersion("v22.4.1")).not.toThrow();
    expect(() => validateNodeVersion("19.9.0")).toThrow(/20 or newer/u);
  });

  it("requires Git 2.31 or newer", () => {
    expect(() => validateGitVersion("git version 2.31.0")).not.toThrow();
    expect(() => validateGitVersion("git version 2.30.9")).toThrow(/2\.31\.0 or newer/u);
  });
});
