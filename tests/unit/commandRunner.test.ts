import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CommandRunner } from "../../src/engine/CommandRunner.js";

describe("CommandRunner", () => {
  it.skipIf(process.platform === "win32")(
    "does not allow background descendants to outlive the configured command",
    async () => {
      const worktree = await mkdtemp(path.join(os.tmpdir(), "branchmesh-command-test-"));
      const markerPath = path.join(worktree, "background-marker");
      try {
        const execution = await new CommandRunner().run(
          {
            id: "background",
            label: "Background process test",
            kind: "custom",
            command:
              "node -e \"setTimeout(() => require('node:fs').writeFileSync('background-marker', 'unexpected'), 500)\" >/dev/null 2>&1 &",
          },
          worktree,
        );

        expect(execution.result.status).toBe("passed");
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(await pathExists(markerPath)).toBe(false);
      } finally {
        await rm(worktree, { recursive: true });
      }
    },
  );
});

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
