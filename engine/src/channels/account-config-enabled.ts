import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveChannelAccountEntry } from "../routing/account-lookup.js";

/** Reads an operator's explicit disable without resolving an operational account. */
export function isChannelAccountExplicitlyDisabled(params: {
  cfg: BranchConfig;
  channel: string;
  accountId: string;
}): boolean {
  const channel = asOptionalRecord(params.cfg.channels?.[params.channel]);
  const account = asOptionalRecord(
    resolveChannelAccountEntry(
      asOptionalRecord(channel?.accounts),
      params.accountId,
      params.channel,
    ),
  );
  return channel?.enabled === false || account?.enabled === false;
}
