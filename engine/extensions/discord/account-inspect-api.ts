import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { inspectDiscordAccount } from "./src/account-inspect.js";

export function inspectDiscordReadOnlyAccount(cfg: BranchConfig, accountId?: string | null) {
  return inspectDiscordAccount({ cfg, accountId });
}
