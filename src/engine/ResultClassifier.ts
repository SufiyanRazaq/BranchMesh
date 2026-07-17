import type {
  BaseClassification,
  BranchClassification,
  CommandResult,
  TechnicalClassification,
} from "../model/results.js";

export function classifyBaseCommandFailure(command: CommandResult): BaseClassification {
  if (command.status === "timed_out") {
    return "BASE_TIMEOUT";
  }
  return command.kind === "setup" ? "BASE_SETUP_FAILURE" : "INVALID_BASELINE";
}

export function classifyBranchCommandFailure(command: CommandResult): BranchClassification {
  if (command.status === "timed_out") {
    return "BRANCH_TIMEOUT";
  }
  switch (command.kind) {
    case "setup":
      return "BRANCH_SETUP_FAILURE";
    case "test":
      return "BRANCH_TEST_FAILURE";
    case "typecheck":
      return "BRANCH_TYPECHECK_FAILURE";
    case "lint":
      return "BRANCH_LINT_FAILURE";
    case "build":
      return "BRANCH_BUILD_FAILURE";
    case "custom":
      return "BRANCH_CUSTOM_FAILURE";
  }
}

export function classifyPairCommandFailure(command: CommandResult): TechnicalClassification {
  if (command.status === "timed_out") {
    return "PAIR_TIMEOUT";
  }
  switch (command.kind) {
    case "setup":
      return "PAIR_SETUP_FAILURE";
    case "test":
      return "PAIR_TEST_FAILURE";
    case "typecheck":
      return "PAIR_TYPECHECK_FAILURE";
    case "lint":
      return "PAIR_LINT_FAILURE";
    case "build":
      return "PAIR_BUILD_FAILURE";
    case "custom":
      return "PAIR_CUSTOM_FAILURE";
  }
}
