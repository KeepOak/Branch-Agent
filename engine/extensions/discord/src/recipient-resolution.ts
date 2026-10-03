import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { requireRuntimeConfig } from "branch/plugin-sdk/plugin-config-runtime";
import { resolveDiscordAccount } from "./accounts.js";
import { parseAndResolveDiscordTarget } from "./target-resolver.js";
import type { DiscordTargetParseOptions } from "./targets.js";

export type DiscordRecipient =
  | {
      kind: "user";
      id: string;
    }
  | {
      kind: "channel";
      id: string;
    };

export async function parseAndResolveRecipient(
  raw: string,
  cfg: BranchConfig,
  accountId?: string,
  parseOptions: DiscordTargetParseOptions = {},
): Promise<DiscordRecipient> {
  const resolvedCfg = requireRuntimeConfig(cfg, "Discord recipient resolution");
  const accountInfo = resolveDiscordAccount({ cfg: resolvedCfg, accountId });
  const resolved = await parseAndResolveDiscordTarget(
    raw,
    {
      cfg: resolvedCfg,
      accountId: accountInfo.accountId,
    },
    parseOptions,
  );
  return { kind: resolved.kind, id: resolved.id };
}

export async function parseAndResolveChannelRecipient(
  raw: string,
  cfg: BranchConfig,
  accountId: string,
): Promise<DiscordRecipient> {
  const resolvedCfg = requireRuntimeConfig(cfg, "Discord recipient resolution");
  const resolved = await parseAndResolveDiscordTarget(
    raw,
    { cfg: resolvedCfg, accountId },
    { defaultKind: "channel" },
  );
  return { kind: resolved.kind, id: resolved.id };
}
