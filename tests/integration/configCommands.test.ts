import { lstat, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeConfiguration } from "../../src/config/initialize.js";
import { loadScanConfig } from "../../src/config/loader.js";
import { applyScanConfigOverrides } from "../../src/config/overrides.js";
import { ScanConfigSchema } from "../../src/config/schema.js";
import { TemporaryGitRepository } from "../helpers/TemporaryGitRepository.js";

describe("configuration commands", () => {
  it("initializes a deterministic npm configuration and never overwrites without --force", async () => {
    const repository = await TemporaryGitRepository.create();
    const packageSource = `${JSON.stringify({
      name: "fixture",
      private: true,
      scripts: {
        test: "node --test",
        typecheck: "tsc --noEmit",
        lint: "eslint .",
        build: "tsup",
      },
    })}\n`;
    await repository.writeFiles({
      "package.json": packageSource,
      "package-lock.json": "{}\n",
    });

    try {
      const outcome = await initializeConfiguration({
        repositoryPath: repository.repositoryPath,
        force: false,
      });
      const parsed = ScanConfigSchema.parse(JSON.parse(await readFile(outcome.configPath, "utf8")));
      expect(outcome.packageManager).toBe("npm");
      expect(outcome.detectedLockfiles).toEqual(["package-lock.json"]);
      expect(parsed.base).toBe("main");
      expect(parsed.branches).toEqual({ source: "worktrees", include: ["*"], exclude: [] });
      expect(parsed.setup?.command).toBe("npm ci --prefer-offline");
      expect(parsed.commands.map((command) => [command.kind, command.command])).toEqual([
        ["test", "npm run test"],
        ["typecheck", "npm run typecheck"],
        ["lint", "npm run lint"],
        ["build", "npm run build"],
      ]);
      expect((await lstat(outcome.configPath)).mode & 0o777).toBe(0o644);

      const original = await readFile(outcome.configPath, "utf8");
      await expect(
        initializeConfiguration({ repositoryPath: repository.repositoryPath, force: false }),
      ).rejects.toMatchObject({ exitCode: 2 });
      expect(await readFile(outcome.configPath, "utf8")).toBe(original);

      await writeFile(outcome.configPath, "reviewed but invalid\n", "utf8");
      await initializeConfiguration({ repositoryPath: repository.repositoryPath, force: true });
      const replacedSource = await readFile(outcome.configPath, "utf8");
      expect(() => {
        JSON.parse(replacedSource);
      }).not.toThrow();
      expect(
        (await listFilesWithPrefix(repository.repositoryPath, ".branchmesh.config.json.")).length,
      ).toBe(0);
    } finally {
      await repository.cleanup();
    }
  });

  it("rejects ambiguous package-manager lockfiles and writes no config", async () => {
    const repository = await TemporaryGitRepository.create();
    await repository.writeFiles({
      "package.json": `${JSON.stringify({ scripts: { test: "node --test" } })}\n`,
      "package-lock.json": "{}\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const configPath = path.join(repository.repositoryPath, "branchmesh.config.json");
    try {
      await expect(
        initializeConfiguration({ repositoryPath: repository.repositoryPath, force: false }),
      ).rejects.toThrow(/conflicting package-manager lockfiles/iu);
      await expect(lstat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await repository.cleanup();
    }
  });

  it("refuses to inspect a package.json reached through a symbolic link", async () => {
    const repository = await TemporaryGitRepository.create();
    const externalPackage = path.join(repository.root, "external-package.json");
    await writeFile(
      externalPackage,
      `${JSON.stringify({ scripts: { test: "node --test" } })}\n`,
      "utf8",
    );
    await symlink(externalPackage, path.join(repository.repositoryPath, "package.json"));
    try {
      await expect(
        initializeConfiguration({ repositoryPath: repository.repositoryPath, force: false }),
      ).rejects.toThrow(/symbolic link/iu);
      expect(await readFile(externalPackage, "utf8")).toContain("node --test");
      await expect(
        lstat(path.join(repository.repositoryPath, "branchmesh.config.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await repository.cleanup();
    }
  });

  it("loads only the repository-root config and revalidates CLI overrides", async () => {
    const repository = await TemporaryGitRepository.create();
    const config = ScanConfigSchema.parse({
      base: "main",
      branches: ["feature/a", "feature/b"],
      commands: [{ id: "test", label: "Tests", kind: "test", command: "node --test" }],
    });
    await repository.writeFiles({
      "branchmesh.config.json": `${JSON.stringify(config, null, 2)}\n`,
      "nested/placeholder.txt": "nested\n",
    });
    try {
      const loaded = await loadScanConfig(path.join(repository.repositoryPath, "nested"));
      expect(loaded.configPath).toBe(
        path.join(repository.repositoryPath, "branchmesh.config.json"),
      );
      expect(
        applyScanConfigOverrides(loaded.config, {
          base: "develop",
          branches: ["feature/c", "feature/d"],
          ignoreDirty: true,
        }),
      ).toMatchObject({
        base: "develop",
        branches: ["feature/c", "feature/d"],
        execution: { ignoreDirty: true },
      });
      expect(() =>
        applyScanConfigOverrides(loaded.config, {
          branches: ["feature/a"],
        }),
      ).toThrow(/branches/iu);
      expect(() =>
        applyScanConfigOverrides(loaded.config, {
          branches: ["feature/a", "feature/b"],
          worktrees: true,
        }),
      ).toThrow(/cannot be used together/iu);
    } finally {
      await repository.cleanup();
    }
  });
});

async function listFilesWithPrefix(directory: string, prefix: string): Promise<string[]> {
  return (await readdir(directory)).filter((entry) => entry.startsWith(prefix));
}
