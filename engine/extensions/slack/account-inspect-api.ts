// Slack API module exposes the plugin public contract.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { inspectSlackAccount } from "./src/account-inspect.js";

export function inspectSlackReadOnlyAccount(cfg: BranchConfig, accountId?: string | null) {
  return inspectSlackAccount({ cfg, accountId });
}
