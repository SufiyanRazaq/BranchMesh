import { describe, expect, it } from "vitest";

import { BRANCHMESH_VERSION, createProgram } from "../../src/index.js";

describe("Milestone 2 CLI boundary", () => {
  it("does not expand the CLI beyond the deterministic demo command", () => {
    const program = createProgram();

    expect(program.name()).toBe("branchmesh");
    expect(program.version()).toBe(BRANCHMESH_VERSION);
    expect(program.commands.map((command) => command.name())).toEqual(["demo"]);
  });
});
