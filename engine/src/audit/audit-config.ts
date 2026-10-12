/** Resolves whether the metadata-only audit ledger records new events. */
import type { BranchConfig } from "../config/types.branch.js";

export type AuditMessageMode = "off" | "direct" | "all";

/**
 * The ledger is on by default: an audit trail enabled only after an incident
 * cannot explain the incident. Disabling collection stops new events; accepted
 * writes drain and queries still serve retained rows until they expire.
 */
export function isAuditLedgerEnabled(cfg: BranchConfig | undefined): boolean {
  return cfg?.logging?.audit?.enabled !== false;
}

/** Execution identity is retained only after an explicit opt-in at run admission. */
export function isExecutionIdentityCollectionEnabled(cfg: BranchConfig | undefined): boolean {
  return isAuditLedgerEnabled(cfg) && cfg?.logging?.audit?.executionIdentity === true;
}

/** Message metadata remains an explicit opt-in inside the default-on ledger. */
export function resolveAuditMessageMode(cfg: BranchConfig | undefined): AuditMessageMode {
  return cfg?.logging?.audit?.messages ?? "off";
}
