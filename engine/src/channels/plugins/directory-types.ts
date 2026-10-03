import type { BranchConfig } from "../../config/types.js";

/**
 * Shared input for channel directory lookups.
 *
 * Directory-capable plugins receive the active config plus optional account
 * scope, search text, and result limit from setup or command surfaces.
 */
export type DirectoryConfigParams = {
  cfg: BranchConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
