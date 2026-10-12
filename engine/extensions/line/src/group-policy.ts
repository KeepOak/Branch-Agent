import {
  buildChannelGroupsScopeTree,
  resolveScopeRequireMention,
} from "branch/plugin-sdk/channel-policy";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveExactLineGroupConfigKey } from "./group-keys.js";

type LineGroupContext = { cfg: BranchConfig; accountId?: string | null; groupId?: string | null };

export function resolveLineGroupRequireMention(params: LineGroupContext): boolean {
  const tree = buildChannelGroupsScopeTree(params.cfg, "line", params.accountId);
  const matchedKey = resolveExactLineGroupConfigKey({
    groups: tree.scopes,
    groupId: params.groupId,
  });
  return resolveScopeRequireMention({
    tree,
    path: matchedKey ? [matchedKey] : [],
  });
}
