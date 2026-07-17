import os from "node:os";
import { describe, expect, it } from "vitest";

import { GitClient } from "../../src/git/GitClient.js";

describe("GitClient", () => {
  it("uses an absolute cwd and captures output", async () => {
    const result = await new GitClient().run(["--version"], { cwd: os.tmpdir() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^git version /u);
    expect(result.cwd).toBe(os.tmpdir());
  });

  it("honors a pre-aborted cancellation signal", async () => {
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(
      new GitClient().run(["--version"], {
        cwd: os.tmpdir(),
        signal: cancellation.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
