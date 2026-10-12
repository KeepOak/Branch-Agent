import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export type BranchDatabaseKind = "agent" | "state";
export type BranchDatabaseQuarantine = {
  kind: BranchDatabaseKind;
  quarantinedAt: number;
  reason: string;
};

export const DATABASE_QUARANTINE_READ_CLEANUP_ERROR_NAME = "BranchQuarantineReadCleanupError";

// Source and compiled worker modules must recognize the same cleanup error identity.
export const BranchQuarantineReadCleanupError = resolveGlobalSingleton(
  Symbol.for("branch.quarantineReadCleanupError"),
  () =>
    class QuarantineReadCleanupError extends AggregateError {
      constructor(
        errors: unknown[],
        readonly quarantine?: BranchDatabaseQuarantine,
      ) {
        super(errors, "Branch Agent quarantine reader cleanup failed.", { cause: errors[0] });
        this.name = DATABASE_QUARANTINE_READ_CLEANUP_ERROR_NAME;
      }
    },
);
export type BranchQuarantineReadCleanupError = InstanceType<
  typeof BranchQuarantineReadCleanupError
>;
