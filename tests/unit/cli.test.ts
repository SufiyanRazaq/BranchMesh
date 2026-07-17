import { describe, expect, it } from "vitest";

import { BRANCHMESH_VERSION, createProgram } from "../../src/index.js";

describe("placeholder CLI", () => {
  it("exposes the BranchMesh identity without implementing product commands", () => {
    const program = createProgram();

    expect(program.name()).toBe("branchmesh");
    expect(program.version()).toBe(BRANCHMESH_VERSION);
    expect(program.commands).toHaveLength(0);
  });
});
