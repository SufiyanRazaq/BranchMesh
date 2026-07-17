export type BranchMeshExitCode = 0 | 1 | 2 | 3 | 4 | 130;

export class BranchMeshError extends Error {
  public readonly exitCode: Exclude<BranchMeshExitCode, 0 | 1 | 3>;

  public constructor(
    message: string,
    exitCode: Exclude<BranchMeshExitCode, 0 | 1 | 3>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BranchMeshError";
    this.exitCode = exitCode;
  }
}

export class UnsupportedRepositoryError extends BranchMeshError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 4, options);
    this.name = "UnsupportedRepositoryError";
  }
}

export class InfrastructureError extends BranchMeshError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 2, options);
    this.name = "InfrastructureError";
  }
}

export function createAbortError(message = "The BranchMesh scan was cancelled"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
