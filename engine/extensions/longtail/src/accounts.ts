import { createAccountListHelpers } from "branch/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, type BranchConfig } from "branch/plugin-sdk/account-resolution";
import type { LongtailAccount, LongtailProvider } from "./send.js";

type RawAccount = Partial<Omit<LongtailAccount, "accountId">> & {
  accounts?: Record<string, RawAccount>;
};

const { listAccountIds, resolveAccountConfig } = createAccountListHelpers<RawAccount>("longtail", {
  fallbackAccountIdWhenEmpty: false,
  hasImplicitDefaultAccount: (cfg) => {
    const channel = cfg.channels?.longtail as RawAccount | undefined;
    return Boolean(channel?.provider);
  },
});

export { listAccountIds };

export function resolveAccount(cfg: BranchConfig, accountId?: string | null): LongtailAccount {
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const raw = resolveAccountConfig(cfg, id);
  return {
    accountId: id,
    enabled: raw.enabled ?? true,
    provider: (raw.provider ?? "") as LongtailProvider | "",
    baseUrl: raw.baseUrl?.trim() ?? "",
    token: raw.token?.trim() ?? "",
    userId: raw.userId?.trim() ?? "",
    email: raw.email?.trim() ?? "",
    defaultTo: raw.defaultTo?.trim() ?? "",
    title: raw.title?.trim() ?? "",
  };
}

export function isConfigured(account: LongtailAccount): boolean {
  if (!account.provider) {
    return false;
  }
  switch (account.provider) {
    case "rocket-chat":
      return Boolean(account.baseUrl && account.token && account.userId);
    case "zulip":
      return Boolean(account.baseUrl && account.token && account.email);
    case "webex":
    case "pushover":
      return Boolean(account.token);
    case "gotify":
      return Boolean(account.baseUrl && account.token);
    case "ntfy":
      return true;
  }
}
