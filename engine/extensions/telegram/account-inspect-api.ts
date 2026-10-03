import type { BranchConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: BranchConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}
