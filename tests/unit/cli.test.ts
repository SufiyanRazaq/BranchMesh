import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";

import { cliErrorExitCode } from "../../src/commands/cliErrors.js";
import { BRANCHMESH_VERSION, createProgram } from "../../src/index.js";
import { ConfigurationError, createAbortError } from "../../src/model/errors.js";
import packageMetadata from "../../package.json" with { type: "json" };

describe("complete CLI boundary", () => {
  it("registers the exact Milestone 5 command set and package version", () => {
    const program = createProgram();

    expect(program.name()).toBe("branchmesh");
    expect(program.version()).toBe(BRANCHMESH_VERSION);
    expect(BRANCHMESH_VERSION).toBe(packageMetadata.version);
    expect(program.commands.map((command) => command.name())).toEqual([
      "init",
      "doctor",
      "scan",
      "demo",
      "clean",
      "version",
    ]);
  });

  it.each([
    ["unknown command", ["not-a-command"]],
    ["unknown flag", ["init", "--not-a-flag"]],
    ["missing option value", ["scan", "--base"]],
    ["malformed branch list", ["scan", "--branches", "feature/a,"]],
  ])("maps %s to configuration exit code 2", async (_label, arguments_) => {
    const error = await parseFailure(arguments_);
    expect(error).toBeInstanceOf(CommanderError);
    expect(cliErrorExitCode(error)).toBe(2);
  });

  it("keeps explicit help and package version at exit code 0", async () => {
    for (const arguments_ of [["--help"], ["--version"], ["scan", "--help"]]) {
      const error = await parseFailure(arguments_);
      expect(error).toBeInstanceOf(CommanderError);
      expect(cliErrorExitCode(error)).toBe(0);
    }
  });

  it("maps configuration and interruption failures without using exit code 1", () => {
    expect(cliErrorExitCode(new ConfigurationError("bad config"))).toBe(2);
    expect(cliErrorExitCode(createAbortError())).toBe(130);
    expect(cliErrorExitCode(new Error("unexpected"))).toBe(2);
  });
});

async function parseFailure(arguments_: readonly string[]): Promise<unknown> {
  const program = createProgram({ stdout: () => undefined, stderr: () => undefined });
  try {
    await program.parseAsync(["node", "branchmesh", ...arguments_]);
    throw new Error("Expected Commander parsing to fail or display help");
  } catch (error: unknown) {
    return error;
  }
}
