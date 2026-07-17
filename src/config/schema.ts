import { z } from "zod";

export const validationCommandKinds = ["test", "typecheck", "lint", "build", "custom"] as const;
export const commandKinds = ["setup", ...validationCommandKinds] as const;

export const ValidationCommandKindSchema = z.enum(validationCommandKinds);
export const CommandKindSchema = z.enum(commandKinds);

export const GitReferenceSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith("-"), "Git references may not start with '-'")
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return (
          character.trim().length > 0 && codePoint > 0x20 && (codePoint < 0x7f || codePoint > 0x9f)
        );
      }),
    "Git references may not contain whitespace or control characters",
  );

const CommandTextSchema = z
  .string()
  .max(16_384)
  .refine((value) => value.trim().length > 0, "Command may not be empty");

const CommandTimeoutSchema = z.number().int().min(1).max(3_600_000);

export const SetupCommandSchema = z.strictObject({
  command: CommandTextSchema,
  timeoutMs: CommandTimeoutSchema.default(300_000),
});

export const ValidationCommandSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  label: z.string().trim().min(1).max(256),
  kind: ValidationCommandKindSchema,
  command: CommandTextSchema,
  timeoutMs: CommandTimeoutSchema.default(120_000),
});

export const WorktreeBranchSelectionSchema = z.strictObject({
  source: z.literal("worktrees"),
  include: z.array(z.string().min(1).max(1024)).max(100).default(["*"]),
  exclude: z.array(z.string().min(1).max(1024)).max(100).default([]),
});

export const BranchSelectionSchema = z.union([
  z.array(GitReferenceSchema).min(2).max(5),
  WorktreeBranchSelectionSchema,
]);

export const ExecutionConfigSchema = z
  .strictObject({
    maxBranches: z.number().int().min(2).max(5).default(5),
    concurrency: z.number().int().min(1).max(2).default(2),
    failFast: z.literal(false).default(false),
    skipPairsWithFailedBranches: z.literal(true).default(true),
    ignoreDirty: z.boolean().default(false),
    maximumLogBytes: z.number().int().min(1024).max(5_000_000).default(200_000),
  })
  .default({
    maxBranches: 5,
    concurrency: 2,
    failFast: false,
    skipPairsWithFailedBranches: true,
    ignoreDirty: false,
    maximumLogBytes: 200_000,
  });

export const ScanConfigSchema = z
  .strictObject({
    $schema: z.string().min(1).optional(),
    base: GitReferenceSchema,
    branches: BranchSelectionSchema,
    setup: SetupCommandSchema.optional(),
    commands: z.array(ValidationCommandSchema).min(1).max(50),
    execution: ExecutionConfigSchema,
  })
  .superRefine((config, context) => {
    const commandIds = new Set<string>();
    for (const [index, command] of config.commands.entries()) {
      if (command.id === "setup") {
        context.addIssue({
          code: "custom",
          message: "The command ID 'setup' is reserved",
          path: ["commands", index, "id"],
        });
      }
      if (commandIds.has(command.id)) {
        context.addIssue({
          code: "custom",
          message: "Command IDs must be unique",
          path: ["commands", index, "id"],
        });
      }
      commandIds.add(command.id);
    }

    if (Array.isArray(config.branches)) {
      const branchRefs = new Set<string>();
      for (const [index, branch] of config.branches.entries()) {
        if (branch === config.base) {
          context.addIssue({
            code: "custom",
            message: "A branch reference may not equal the base reference",
            path: ["branches", index],
          });
        }
        if (branchRefs.has(branch)) {
          context.addIssue({
            code: "custom",
            message: "Branch references must be unique",
            path: ["branches", index],
          });
        }
        branchRefs.add(branch);
      }

      if (config.branches.length > config.execution.maxBranches) {
        context.addIssue({
          code: "custom",
          message: "Selected branches exceed execution.maxBranches",
          path: ["branches"],
        });
      }
    }
  });

export type CommandKind = z.infer<typeof CommandKindSchema>;
export type ValidationCommandKind = z.infer<typeof ValidationCommandKindSchema>;
export type SetupCommand = z.infer<typeof SetupCommandSchema>;
export type ValidationCommand = z.infer<typeof ValidationCommandSchema>;
export type ScanConfig = z.infer<typeof ScanConfigSchema>;

export function parseScanConfig(input: unknown): ScanConfig {
  return ScanConfigSchema.parse(input);
}

// Milestone 1 exported these names. Keep source compatibility while the CLI remains deliberately
// minimal; both aliases now enforce the complete Milestone 2 contract.
export const VerticalSliceConfigSchema = ScanConfigSchema;
export type VerticalSliceConfig = ScanConfig;
export const parseVerticalSliceConfig = parseScanConfig;
