import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { assertGitSuccess, GitClient } from "../git/GitClient.js";
import { isPathInside } from "../utils/paths.js";

export const DEMO_BASE_REF = "main";
export const DEMO_BRANCH_A_REF = "feature/config-seconds";
export const DEMO_BRANCH_B_REF = "feature/jitter";
export const DEMO_BRANCH_C_REF = "feature/status-output";

const markerFileName = ".branchmesh-demo-owner.json";

const DemoOwnershipMarkerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  owner: z.literal("branchmesh-demo"),
  ownershipToken: z.string().uuid(),
});

export interface DemoRepository {
  readonly root: string;
  readonly repositoryPath: string;
  readonly baseRef: typeof DEMO_BASE_REF;
  readonly branchARef: typeof DEMO_BRANCH_A_REF;
  readonly branchBRef: typeof DEMO_BRANCH_B_REF;
  readonly branchCRef: typeof DEMO_BRANCH_C_REF;
  cleanup(): Promise<void>;
}

const baseFiles = {
  "package.json": `${JSON.stringify(
    {
      name: "branchmesh-demo-fixture",
      private: true,
      type: "module",
    },
    null,
    2,
  )}\n`,
  "src/config.js": `export const retryConfig = { retryDelayMs: 1000 };\n`,
  "src/retry.js": [
    `import { retryConfig } from "./config.js";`,
    "",
    "export function retryDelayInMilliseconds() {",
    "  return retryConfig.retryDelayMs;",
    "}",
    "",
  ].join("\n"),
  "test/retry.test.js": [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    "",
    `import { retryDelayInMilliseconds } from "../src/retry.js";`,
    "",
    `test("the retry delay remains one second", () => {`,
    "  assert.equal(retryDelayInMilliseconds(), 1000);",
    "});",
    "",
  ].join("\n"),
} as const;

const fixedCommitEnvironment: NodeJS.ProcessEnv = {
  GIT_AUTHOR_DATE: "2026-07-17T09:00:00Z",
  GIT_COMMITTER_DATE: "2026-07-17T09:00:00Z",
};

export async function createDemoRepository(): Promise<DemoRepository> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "branchmesh-demo-")));
  const ownershipToken = randomUUID();
  const repositoryPath = path.join(root, "repository");

  try {
    await chmod(root, 0o700);
    await writeFile(
      path.join(root, markerFileName),
      `${JSON.stringify(
        DemoOwnershipMarkerSchema.parse({
          schemaVersion: 1,
          owner: "branchmesh-demo",
          ownershipToken,
        }),
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await mkdir(path.join(root, "hooks"), { mode: 0o700 });

    const git = new GitClient();
    assertGitSuccess(
      await git.run(["init", `--initial-branch=${DEMO_BASE_REF}`, repositoryPath], {
        cwd: root,
      }),
      "Demo repository initialization",
    );
    await configureIdentity(git, root, repositoryPath);

    await writeFixtureFiles(repositoryPath, baseFiles);
    await commitAll(git, root, repositoryPath, "Create passing retry baseline", 0);

    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["switch", "--create", DEMO_BRANCH_A_REF],
      "Demo Branch A creation",
    );
    await writeFixtureFiles(repositoryPath, {
      "src/config.js": `export const retryConfig = { retryDelaySeconds: 1 };\n`,
      "src/retry.js": [
        `import { retryConfig } from "./config.js";`,
        "",
        "export function retryDelayInMilliseconds() {",
        "  return retryConfig.retryDelaySeconds * 1000;",
        "}",
        "",
      ].join("\n"),
    });
    await commitAll(git, root, repositoryPath, "Store retry delay in seconds", 1);

    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["switch", DEMO_BASE_REF],
      "Return demo repository to base",
    );
    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["switch", "--create", DEMO_BRANCH_B_REF],
      "Demo Branch B creation",
    );
    await writeFixtureFiles(repositoryPath, {
      "src/jitter.js": [
        `import { retryConfig } from "./config.js";`,
        "",
        "export function retryDelayWithJitter() {",
        "  return retryConfig.retryDelayMs + 100;",
        "}",
        "",
      ].join("\n"),
      "test/jitter.test.js": [
        `import assert from "node:assert/strict";`,
        `import test from "node:test";`,
        "",
        `import { retryDelayWithJitter } from "../src/jitter.js";`,
        "",
        `test("jitter adds one hundred milliseconds", () => {`,
        "  assert.equal(retryDelayWithJitter(), 1100);",
        "});",
        "",
      ].join("\n"),
    });
    await commitAll(git, root, repositoryPath, "Add retry jitter", 2);

    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["switch", DEMO_BASE_REF],
      "Restore demo repository to base",
    );
    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["switch", "--create", DEMO_BRANCH_C_REF],
      "Demo Branch C creation",
    );
    await writeFixtureFiles(repositoryPath, {
      "src/status.js": ["export function retryStatus() {", '  return "ready";', "}", ""].join("\n"),
      "test/status.test.js": [
        `import assert from "node:assert/strict";`,
        `import test from "node:test";`,
        "",
        `import { retryStatus } from "../src/status.js";`,
        "",
        `test("the retry status is ready", () => {`,
        '  assert.equal(retryStatus(), "ready");',
        "});",
        "",
      ].join("\n"),
    });
    await commitAll(git, root, repositoryPath, "Add retry status output", 3);

    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["switch", DEMO_BASE_REF],
      "Restore demo repository to base after Branch C",
    );

    let cleaned = false;
    return {
      root,
      repositoryPath,
      baseRef: DEMO_BASE_REF,
      branchARef: DEMO_BRANCH_A_REF,
      branchBRef: DEMO_BRANCH_B_REF,
      branchCRef: DEMO_BRANCH_C_REF,
      cleanup: async () => {
        if (cleaned) {
          return;
        }
        await cleanupDemoRoot(root, ownershipToken);
        cleaned = true;
      },
    };
  } catch (error: unknown) {
    await removeNewlyCreatedDemoRoot(root);
    throw error;
  }
}

async function configureIdentity(
  git: GitClient,
  root: string,
  repositoryPath: string,
): Promise<void> {
  for (const [key, value] of [
    ["user.name", "BranchMesh Demo"],
    ["user.email", "branchmesh-demo@local"],
    ["commit.gpgSign", "false"],
    ["core.autocrlf", "false"],
    ["core.fileMode", "false"],
    ["core.safecrlf", "false"],
  ] as const) {
    await runFixtureGit(
      git,
      root,
      repositoryPath,
      ["config", "--local", key, value],
      `Demo Git configuration (${key})`,
    );
  }
}

async function commitAll(
  git: GitClient,
  root: string,
  repositoryPath: string,
  message: string,
  minuteOffset: number,
): Promise<void> {
  await runFixtureGit(git, root, repositoryPath, ["add", "--all"], "Stage demo fixture files");
  const commitTime = `2026-07-17T09:0${String(minuteOffset)}:00Z`;
  await runFixtureGit(
    git,
    root,
    repositoryPath,
    ["commit", "--message", message],
    "Commit demo fixture files",
    {
      ...fixedCommitEnvironment,
      GIT_AUTHOR_DATE: commitTime,
      GIT_COMMITTER_DATE: commitTime,
    },
  );
}

async function runFixtureGit(
  git: GitClient,
  root: string,
  repositoryPath: string,
  args: readonly string[],
  operation: string,
  environment?: NodeJS.ProcessEnv,
): Promise<void> {
  assertGitSuccess(
    await git.run(
      ["-c", `core.hooksPath=${path.join(root, "hooks")}`, "-C", repositoryPath, ...args],
      {
        cwd: root,
        ...(environment === undefined ? {} : { env: environment }),
      },
    ),
    operation,
  );
}

async function writeFixtureFiles(
  repositoryPath: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function cleanupDemoRoot(root: string, ownershipToken: string): Promise<void> {
  await assertDemoRootLocation(root);

  const marker = DemoOwnershipMarkerSchema.parse(
    JSON.parse(await readFile(path.join(root, markerFileName), "utf8")),
  );
  if (marker.ownershipToken !== ownershipToken) {
    throw new Error("BranchMesh demo ownership token does not match");
  }

  await rm(root, { recursive: true });
}

async function removeNewlyCreatedDemoRoot(root: string): Promise<void> {
  await assertDemoRootLocation(root);
  await rm(root, { recursive: true });
}

async function assertDemoRootLocation(root: string): Promise<void> {
  const canonicalTemporaryDirectory = await realpath(os.tmpdir());
  if (
    !isPathInside(canonicalTemporaryDirectory, root) ||
    !path.basename(root).startsWith("branchmesh-demo-")
  ) {
    throw new Error("Refusing to remove an invalid BranchMesh demo directory");
  }
}
