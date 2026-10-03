import path from "node:path";
import type { CodexPluginConfig } from "./config-contracts.js";
import { readCodexPluginConfig } from "./config-parsing.js";

export function readCodexNativeAccounts(value: unknown) {
  const config = readCodexPluginConfig(value);
  const app = config.appServer;
  if (!app?.nativeAccounts) {
    if (app?.nativeAccountId || app?.nativeAccountQuotaFailover) {
      throw new Error("Codex native account selection requires nativeAccounts");
    }
    return undefined;
  }
  if (app.homeScope !== "user" || (app.transport ?? "stdio") !== "stdio" || app.codexHome) {
    throw new Error("Codex nativeAccounts requires user-scoped stdio without codexHome");
  }
  const accounts = app.nativeAccounts.map((account) => {
    if (!path.isAbsolute(account.home)) {
      throw new Error("Codex native account homes must be absolute paths");
    }
    return { ...account, home: path.resolve(account.home) };
  });
  const homes = accounts.map(({ home }) =>
    process.platform === "win32" ? home.toLowerCase() : home,
  );
  if (
    new Set(accounts.map(({ id }) => id)).size !== accounts.length ||
    new Set(homes).size !== accounts.length
  ) {
    throw new Error("Codex native accounts require unique IDs and isolated homes");
  }
  const selected = accounts.find(({ id }) => id === app.nativeAccountId);
  if (!selected) {
    throw new Error("Codex nativeAccountId must select a registered account");
  }
  return { config, accounts, selected, quotaFailover: app.nativeAccountQuotaFailover === true };
}

export function projectCodexNativeAccount(
  config: CodexPluginConfig,
  home: string,
): CodexPluginConfig {
  const {
    nativeAccounts: _accounts,
    nativeAccountId: _id,
    nativeAccountQuotaFailover: _failover,
    ...app
  } = config.appServer ?? {};
  return {
    ...config,
    appServer: {
      ...app,
      codexHome: home,
      clearEnv: [
        ...new Set([
          ...(app.clearEnv ?? []),
          "CODEX_API_KEY",
          "OPENAI_API_KEY",
          "CODEX_ACCESS_TOKEN",
        ]),
      ],
    },
  };
}

/** Only structured read-only quota exhaustion permits another account candidate. */
export async function selectCodexNativeAccount<T>(params: {
  value: unknown;
  bindingHome?: string;
  hasBinding?: boolean;
  signal?: AbortSignal;
  inspect: (
    config: CodexPluginConfig,
  ) => Promise<{ authenticated: boolean; blocked: boolean | undefined }>;
  run: (config: CodexPluginConfig, home: string) => Promise<T>;
}): Promise<T> {
  const registry = readCodexNativeAccounts(params.value);
  if (!registry) {
    throw new Error("No Codex native account registry configured");
  }
  if (params.hasBinding) {
    // Never attach an existing thread to a newly selected/default account.
    if (!params.bindingHome || !registry.accounts.some(({ home }) => home === params.bindingHome)) {
      throw new Error(
        "Existing Codex thread has no registered native account owner; explicit migration required",
      );
    }
    params.signal?.throwIfAborted();
    return params.run(
      projectCodexNativeAccount(registry.config, params.bindingHome),
      params.bindingHome,
    );
  }
  const candidates = [
    registry.selected,
    ...registry.accounts.filter(({ id }) => id !== registry.selected.id),
  ];
  for (const candidate of candidates) {
    params.signal?.throwIfAborted();
    const config = projectCodexNativeAccount(registry.config, candidate.home);
    // Auth, transport, timeout and unrelated errors propagate; they never rotate accounts.
    const status = await params.inspect(config);
    params.signal?.throwIfAborted();
    if (!status.authenticated) {
      throw new Error(
        "Selected Codex native account is not authenticated; sign in to its home explicitly",
      );
    }
    if (status.blocked === true && registry.quotaFailover) {
      continue;
    }
    // Once a turn is handed off there is no retry, including quota failures.
    return params.run(config, candidate.home);
  }
  throw new Error("All registered Codex native accounts report exhausted quota");
}
