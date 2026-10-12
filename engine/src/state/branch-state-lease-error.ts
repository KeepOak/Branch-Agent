const leaseErrorCodes = [
  "BRANCH_STATE_LEASE_INVALID_INPUT",
  "BRANCH_STATE_LEASE_HELD",
  "BRANCH_STATE_LEASE_ABORTED",
  "BRANCH_STATE_LEASE_LOST",
  "BRANCH_STATE_LEASE_STORAGE_FAILED",
] as const;
export type BranchStateLeaseErrorCode = (typeof leaseErrorCodes)[number];

type BranchStateLeaseAcquisitionFailure =
  | { kind: "held"; holder: { owner: string; epoch: number } }
  | { kind: "store-unavailable"; reason: "sqlite-busy" | "lifecycle-busy" | "storage-error" }
  | { kind: "aborted"; reason: "caller-signal"; elapsedMs: number };

export function isBranchStateLeaseErrorCode(
  value: unknown,
): value is BranchStateLeaseErrorCode {
  return leaseErrorCodes.some((code) => code === value);
}

export class BranchStateLeaseError extends Error {
  readonly code: BranchStateLeaseErrorCode;

  constructor(message: string, options: { code: BranchStateLeaseErrorCode; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "BranchStateLeaseError";
    this.code = options.code;
  }
}

export class BranchStateLeaseAcquisitionError extends BranchStateLeaseError {
  constructor(
    label: string,
    readonly outcome: BranchStateLeaseAcquisitionFailure,
    cause?: unknown,
  ) {
    super(
      outcome.kind === "held"
        ? `${label} is held by ${outcome.holder.owner} (lease epoch ${outcome.holder.epoch})`
        : outcome.kind === "aborted"
          ? `${label} acquisition was aborted after ${outcome.elapsedMs} ms by caller signal`
          : `failed to acquire ${label}: store unavailable (${outcome.reason})`,
      {
        code:
          outcome.kind === "held"
            ? "BRANCH_STATE_LEASE_HELD"
            : outcome.kind === "aborted"
              ? "BRANCH_STATE_LEASE_ABORTED"
              : "BRANCH_STATE_LEASE_STORAGE_FAILED",
        cause,
      },
    );
  }
}

export function toBranchStateLeaseVerificationError(
  identity: { scope: string; key: string; leaseLabel?: string },
  error: unknown,
): BranchStateLeaseError {
  return error instanceof BranchStateLeaseError
    ? error
    : new BranchStateLeaseError(
        `failed to verify ${identity.leaseLabel ?? "state lease"} ${identity.scope}/${identity.key}`,
        { code: "BRANCH_STATE_LEASE_STORAGE_FAILED", cause: error },
      );
}

export function createBranchStateLeaseError(
  code: BranchStateLeaseErrorCode,
  message: string,
  cause?: unknown,
): BranchStateLeaseError {
  return new BranchStateLeaseError(message, { code, cause });
}

export function createBranchStateLeaseLostError(
  identity: { scope: string; key: string; leaseLabel?: string },
  cause?: unknown,
): BranchStateLeaseError {
  return createBranchStateLeaseError(
    "BRANCH_STATE_LEASE_LOST",
    `${identity.leaseLabel ?? "state lease"} ${identity.scope}/${identity.key} was lost`,
    cause,
  );
}

export function createBranchStateLeaseAbortError(
  signal: AbortSignal,
  label: string,
  leaseLabel: string,
): BranchStateLeaseError {
  return createBranchStateLeaseError(
    "BRANCH_STATE_LEASE_ABORTED",
    `${leaseLabel} ${label} was aborted`,
    signal.reason,
  );
}
