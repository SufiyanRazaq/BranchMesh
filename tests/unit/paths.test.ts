import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createRepositoryFingerprint,
  resolveReportDirectories,
  resolveSafeOutputDirectory,
} from "../../src/utils/paths.js";

describe("persistent output safety", () => {
  it("organizes default reports by repository fingerprint and run ID", () => {
    const commonGitDirectory = "/repositories/example/.git";
    const dataRoot = "/branchmesh-data";
    const directories = resolveReportDirectories(
      commonGitDirectory,
      "run-123",
      undefined,
      dataRoot,
    );
    const repositoryDirectory = path.join(
      dataRoot,
      "repositories",
      createRepositoryFingerprint(commonGitDirectory),
    );

    expect(directories).toEqual({
      runDirectory: path.join(repositoryDirectory, "runs", "run-123"),
      latestDirectory: path.join(repositoryDirectory, "latest"),
    });
    expect(resolveReportDirectories(commonGitDirectory, "run-123", "./reports", dataRoot)).toEqual({
      runDirectory: path.resolve("./reports"),
      latestDirectory: null,
    });
  });

  it("rejects direct and symlinked destinations inside the scanned repository", async () => {
    const testRoot = await mkdtemp(path.join(os.tmpdir(), "branchmesh-path-test-"));
    const repositoryRoot = path.join(testRoot, "repository");
    const outsideRoot = path.join(testRoot, "outside");
    await Promise.all([mkdir(repositoryRoot), mkdir(outsideRoot)]);

    try {
      await expect(
        resolveSafeOutputDirectory(repositoryRoot, path.join(repositoryRoot, "reports")),
      ).rejects.toThrow(/outside the scanned repository/u);

      const linkedRepository = path.join(outsideRoot, "repository-link");
      await symlink(repositoryRoot, linkedRepository);
      await expect(
        resolveSafeOutputDirectory(repositoryRoot, path.join(linkedRepository, "reports")),
      ).rejects.toThrow(/outside the scanned repository/u);
    } finally {
      await rm(testRoot, { recursive: true });
    }
  });
});
