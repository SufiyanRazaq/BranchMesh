import type { BranchSnapshot } from "../model/results.js";

export interface BranchJobPlan {
  readonly id: string;
  readonly kind: "branch";
  readonly index: number;
  readonly branches: readonly [BranchSnapshot];
}

export interface PairJobPlan {
  readonly id: string;
  readonly kind: "pair";
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly branches: readonly [BranchSnapshot, BranchSnapshot];
}

export interface ScanJobPlan {
  readonly branches: readonly BranchJobPlan[];
  readonly pairs: readonly PairJobPlan[];
}

export function planScanJobs(snapshots: readonly BranchSnapshot[]): ScanJobPlan {
  const ordered = [...snapshots].sort((left, right) => compareText(left.ref, right.ref));
  if (ordered.some((snapshot, index) => snapshot !== snapshots[index])) {
    throw new Error("Scan job planning requires deterministically ordered branch snapshots");
  }

  const branches: BranchJobPlan[] = ordered.map((snapshot, index) => ({
    id: `branch-${String(index)}`,
    kind: "branch",
    index,
    branches: [snapshot],
  }));
  const pairs: PairJobPlan[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex];
      const right = ordered[rightIndex];
      if (left !== undefined && right !== undefined) {
        pairs.push({
          id: `pair-${String(leftIndex)}-${String(rightIndex)}`,
          kind: "pair",
          leftIndex,
          rightIndex,
          branches: [left, right],
        });
      }
    }
  }
  return { branches, pairs };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
