import { assertNoLegacyDeviceAuth } from "../infra/device-auth-store.js";
import { loadDeviceIdentityIfPresent } from "../infra/device-identity.js";
import { assertNoPendingLegacyExecApprovals } from "../infra/exec-approvals-migration-gate.js";
import { getExistingBranchStateSchemaPath } from "../state/branch-state-db-schema-policy.js";
import { initializeNativeBranchStateDatabase } from "../state/branch-state-db.js";

export function ensureNodeHostStateReady(): void {
  // Native clients can create version-zero tables before this node starts.
  // Complete their canonical bootstrap before read-only readiness checks.
  if (!getExistingBranchStateSchemaPath()) {
    initializeNativeBranchStateDatabase();
  }
  assertNoLegacyDeviceAuth(process.env);
  assertNoPendingLegacyExecApprovals();
  loadDeviceIdentityIfPresent();
}
