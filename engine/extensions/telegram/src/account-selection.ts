import {
  createAccountListHelpers,
  hasConfiguredAccountValue,
  resolveListedDefaultAccountId,
} from "branch/plugin-sdk/account-core";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "branch/plugin-sdk/account-id";
import { listAgentIds } from "branch/plugin-sdk/agent-scope-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveDefaultAgentBoundAccountId } from "branch/plugin-sdk/routing";
import { normalizeLowercaseStringOrEmpty } from "branch/plugin-sdk/string-coerce-runtime";
import { resolveTelegramAccountConfig } from "./account-config.js";

function resolveTelegramBindingAccountId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const binding = value as {
    match?: { channel?: unknown; accountId?: unknown };
  };
  if (normalizeLowercaseStringOrEmpty(binding.match?.channel) !== "telegram") {
    return null;
  }
  const accountId = typeof binding.match?.accountId === "string" ? binding.match.accountId : "";
  if (!accountId.trim() || accountId.trim() === "*") {
    return null;
  }
  return normalizeAccountId(accountId);
}

export function hasTelegramAccountConfig(cfg: BranchConfig, accountId: string): boolean {
  const normalized = normalizeAccountId(accountId);
  if (resolveTelegramAccountConfig(cfg, normalized)) {
    return true;
  }
  const channel = cfg.channels?.telegram;
  if (
    normalized !== DEFAULT_ACCOUNT_ID &&
    (Object.keys(channel?.accounts ?? {}).length > 0 ||
      !cfg.bindings?.some((binding) => resolveTelegramBindingAccountId(binding) === normalized))
  ) {
    return false;
  }
  return (
    hasConfiguredAccountValue(channel?.botToken) ||
    hasConfiguredAccountValue(channel?.tokenFile) ||
    (normalized === DEFAULT_ACCOUNT_ID && hasConfiguredAccountValue(process.env.TELEGRAM_BOT_TOKEN))
  );
}

const { listAccountIds: listTelegramAccountIds } = createAccountListHelpers("telegram", {
  normalizeAccountId,
  additionalAccountIds: (cfg) =>
    [
      ...new Set(
        (cfg.bindings ?? []).map(resolveTelegramBindingAccountId).filter((id) => id !== null),
      ),
    ].toSorted((left, right) => left.localeCompare(right)),
  hasImplicitDefaultAccount: (cfg) => hasTelegramAccountConfig(cfg, DEFAULT_ACCOUNT_ID),
});

export { listTelegramAccountIds };

export function resolveDefaultTelegramAccountSelection(cfg: BranchConfig): {
  accountId: string;
  accountIds: string[];
  shouldWarnMissingDefault: boolean;
} {
  // Explicit fleets use channel defaults, not a retained legacy migration owner.
  const boundDefault =
    cfg.agents?.ownership === "explicit" && listAgentIds(cfg).length !== 1
      ? null
      : resolveDefaultAgentBoundAccountId(cfg, "telegram");
  if (boundDefault) {
    return {
      accountId: boundDefault,
      accountIds: listTelegramAccountIds(cfg),
      shouldWarnMissingDefault: false,
    };
  }
  const accountIds = listTelegramAccountIds(cfg);
  const configuredDefaultAccountId =
    normalizeOptionalAccountId(cfg.channels?.telegram?.defaultAccount) ?? undefined;
  const hasExplicitDefaultAccount = configuredDefaultAccountId
    ? accountIds.includes(configuredDefaultAccountId)
    : false;
  const resolved = resolveListedDefaultAccountId({
    accountIds,
    configuredDefaultAccountId,
  });
  return {
    accountId: resolved,
    accountIds,
    shouldWarnMissingDefault:
      resolved === accountIds[0] &&
      !hasExplicitDefaultAccount &&
      !accountIds.includes(DEFAULT_ACCOUNT_ID) &&
      accountIds.length > 1,
  };
}

export function resolveDefaultTelegramAccountId(cfg: BranchConfig): string {
  return resolveDefaultTelegramAccountSelection(cfg).accountId;
}
