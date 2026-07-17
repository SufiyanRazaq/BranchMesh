import type { PrimaryClassification, TechnicalClassification } from "../model/results.js";

const primaryLabels: Record<PrimaryClassification, string> = {
  BASE_PASS: "Base passed",
  INVALID_BASELINE: "Invalid baseline",
  BASE_SETUP_FAILURE: "Base setup failure",
  BASE_TIMEOUT: "Base timeout",
  BRANCH_PASS: "Branch passed",
  BASE_MERGE_CONFLICT: "Base merge conflict",
  BRANCH_TEST_FAILURE: "Branch test failure",
  BRANCH_TYPECHECK_FAILURE: "Branch type-check failure",
  BRANCH_LINT_FAILURE: "Branch lint failure",
  BRANCH_BUILD_FAILURE: "Branch build failure",
  BRANCH_CUSTOM_FAILURE: "Branch custom-command failure",
  BRANCH_SETUP_FAILURE: "Branch setup failure",
  BRANCH_TIMEOUT: "Branch timeout",
  NO_DETECTED_CONFLICT: "No detected conflict",
  TEXTUAL_CONFLICT: "Textual Git conflict",
  BEHAVIORAL_CONFLICT: "Behavioral conflict",
  PAIR_SKIPPED: "Pair skipped",
};

const technicalLabels: Record<TechnicalClassification, string> = {
  PAIR_TEST_FAILURE: "Test failure",
  PAIR_TYPECHECK_FAILURE: "Type-check failure",
  PAIR_LINT_FAILURE: "Lint failure",
  PAIR_BUILD_FAILURE: "Build failure",
  PAIR_CUSTOM_FAILURE: "Custom-command failure",
  PAIR_SETUP_FAILURE: "Setup failure",
  PAIR_TIMEOUT: "Timeout",
};

export type ClassificationTone = "pass" | "fail" | "warning" | "skipped";

export function primaryClassificationLabel(classification: PrimaryClassification): string {
  return primaryLabels[classification];
}

export function technicalClassificationLabel(classification: TechnicalClassification): string {
  return technicalLabels[classification];
}

export function classificationTone(classification: PrimaryClassification): ClassificationTone {
  if (
    classification === "BASE_PASS" ||
    classification === "BRANCH_PASS" ||
    classification === "NO_DETECTED_CONFLICT"
  ) {
    return "pass";
  }
  if (classification === "PAIR_SKIPPED") {
    return "skipped";
  }
  if (classification === "TEXTUAL_CONFLICT" || classification === "BASE_MERGE_CONFLICT") {
    return "warning";
  }
  return "fail";
}
