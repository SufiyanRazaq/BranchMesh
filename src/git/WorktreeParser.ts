export interface DiscoveredWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

interface MutableWorktree {
  path?: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export function parseWorktreePorcelainZ(output: string): DiscoveredWorktree[] {
  const worktrees: DiscoveredWorktree[] = [];
  let current = newMutableWorktree();

  const finishRecord = (): void => {
    if (current.path === undefined) {
      if (hasAnyField(current)) {
        throw new Error("Malformed Git worktree record has no path");
      }
      return;
    }
    if (!current.bare && current.head === undefined) {
      throw new Error(`Malformed Git worktree record for ${current.path} has no HEAD`);
    }
    worktrees.push({
      path: current.path,
      head: current.head ?? null,
      branch: current.branch ?? null,
      detached: current.detached,
      bare: current.bare,
      locked: current.locked,
      prunable: current.prunable,
    });
    current = newMutableWorktree();
  };

  for (const field of output.split("\0")) {
    if (field.length === 0) {
      finishRecord();
      continue;
    }

    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? "" : field.slice(separator + 1);
    switch (key) {
      case "worktree":
        if (current.path !== undefined) {
          throw new Error("Malformed Git worktree record has duplicate paths");
        }
        current.path = value;
        break;
      case "HEAD":
        current.head = value.toLowerCase();
        break;
      case "branch":
        current.branch = value;
        break;
      case "detached":
        current.detached = true;
        break;
      case "bare":
        current.bare = true;
        break;
      case "locked":
        current.locked = true;
        break;
      case "prunable":
        current.prunable = true;
        break;
      default:
        // Porcelain format may gain fields. Unknown fields cannot affect ownership decisions.
        break;
    }
  }

  finishRecord();
  return worktrees;
}

function newMutableWorktree(): MutableWorktree {
  return { detached: false, bare: false, locked: false, prunable: false };
}

function hasAnyField(worktree: MutableWorktree): boolean {
  return (
    worktree.path !== undefined ||
    worktree.head !== undefined ||
    worktree.branch !== undefined ||
    worktree.detached ||
    worktree.bare ||
    worktree.locked ||
    worktree.prunable
  );
}
