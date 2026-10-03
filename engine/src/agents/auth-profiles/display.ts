/**
 * Auth profile display labels.
 * Combines profile ids with configured human metadata for CLI/status output.
 */
import type { BranchConfig } from "../../config/types.branch.js";
import { resolveAuthProfileMetadata } from "./identity.js";
import type { AuthProfileStore } from "./types.js";

/** Builds the human-readable profile label used in status and auth listings. */
export function resolveAuthProfileDisplayLabel(params: {
  cfg?: BranchConfig;
  store: AuthProfileStore;
  profileId: string;
}): string {
  const { displayName, email } = resolveAuthProfileMetadata(params);
  const label = displayName || email;
  return label ? `${params.profileId} (${label})` : params.profileId;
}
