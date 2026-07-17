import { z } from "zod";

export const commandKinds = ["test", "typecheck", "lint", "build", "custom"] as const;

export const CommandKindSchema = z.enum(commandKinds);

const GitReferenceSchema = z
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

export const ValidationCommandSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  label: z.string().trim().min(1),
  kind: CommandKindSchema,
  command: z.string().refine((value) => value.trim().length > 0, "Command may not be empty"),
});

export const VerticalSliceConfigSchema = z
  .strictObject({
    base: GitReferenceSchema,
    branches: z.tuple([GitReferenceSchema, GitReferenceSchema]),
    commands: z.tuple([ValidationCommandSchema]),
  })
  .superRefine((config, context) => {
    const [branchA, branchB] = config.branches;

    if (branchA === branchB) {
      context.addIssue({
        code: "custom",
        message: "The two branch references must be distinct",
        path: ["branches", 1],
      });
    }

    for (const [index, branch] of config.branches.entries()) {
      if (branch === config.base) {
        context.addIssue({
          code: "custom",
          message: "A branch reference may not equal the base reference",
          path: ["branches", index],
        });
      }
    }
  });

export type CommandKind = z.infer<typeof CommandKindSchema>;
export type ValidationCommand = z.infer<typeof ValidationCommandSchema>;
export type VerticalSliceConfig = z.infer<typeof VerticalSliceConfigSchema>;

export function parseVerticalSliceConfig(input: unknown): VerticalSliceConfig {
  return VerticalSliceConfigSchema.parse(input);
}
