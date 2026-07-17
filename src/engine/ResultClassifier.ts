import type { CommandKind } from "../config/schema.js";
import type { BranchClassification, TechnicalClassification } from "../model/results.js";

const branchFailureByKind: Record<CommandKind, BranchClassification> = {
  test: "BRANCH_TEST_FAILURE",
  typecheck: "BRANCH_TYPECHECK_FAILURE",
  lint: "BRANCH_LINT_FAILURE",
  build: "BRANCH_BUILD_FAILURE",
  custom: "BRANCH_CUSTOM_FAILURE",
};

const pairFailureByKind: Record<CommandKind, TechnicalClassification> = {
  test: "PAIR_TEST_FAILURE",
  typecheck: "PAIR_TYPECHECK_FAILURE",
  lint: "PAIR_LINT_FAILURE",
  build: "PAIR_BUILD_FAILURE",
  custom: "PAIR_CUSTOM_FAILURE",
};

export function classifyBranchCommandFailure(kind: CommandKind): BranchClassification {
  return branchFailureByKind[kind];
}

export function classifyPairCommandFailure(kind: CommandKind): TechnicalClassification {
  return pairFailureByKind[kind];
}
