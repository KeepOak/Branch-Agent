import type { DatabaseSync } from "node:sqlite";
import { verifyBranchStateLeaseOwnership } from "../../state/branch-state-lease-storage.js";
import type { BranchStateLeaseIdentity } from "../../state/branch-state-lease.types.js";
/** Nested savepoints remain inside the original admitted outer transaction. Never consume its single commit grant early. */
export function assertSkillFoundationTransactionCurrent(
  db: DatabaseSync,
  leases?: readonly BranchStateLeaseIdentity[],
) {
  if (!db.isTransaction) throw Error("Skill foundation requires its admitted outer transaction.");
  if (
    leases &&
    (!leases.length ||
      new Set(leases.map((lease) => JSON.stringify([lease.scope, lease.key]))).size !==
        leases.length)
  )
    throw Error("Skill foundation requires distinct retained lease identities.");
  for (const lease of leases ?? [])
    verifyBranchStateLeaseOwnership({
      ...lease,
      transaction: db,
      leaseLabel: "Skill foundation lease",
    });
}
