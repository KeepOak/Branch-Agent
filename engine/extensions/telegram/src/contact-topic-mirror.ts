import { resolveGlobalSingleton } from "branch/plugin-sdk/global-singleton";
import type { PluginStateKeyedStore } from "branch/plugin-sdk/plugin-state-runtime";
import { getTelegramRuntime } from "./runtime.js";

type Mirror = { sessionKey: string };
type AccountMirrors = {
  rows: Map<string, Mirror>;
  store: PluginStateKeyedStore<Mirror>;
  loaded: boolean;
  loading?: Promise<void>;
};

const stateKey = Symbol.for("branch.telegramContactTopicMirrors");
const namespace = "telegram.contact-topic-mirror";

function accountMirrors(accountId: string): AccountMirrors {
  const accounts = resolveGlobalSingleton(stateKey, () => new Map<string, AccountMirrors>());
  const existing = accounts.get(accountId);
  if (existing) return existing;
  const next: AccountMirrors = {
    rows: new Map(),
    store: getTelegramRuntime().state.openKeyedStore<Mirror>({
      namespace: `${namespace}.${accountId}`,
      maxEntries: Number.MAX_SAFE_INTEGER,
    }),
    loaded: false,
  };
  accounts.set(accountId, next);
  return next;
}

function mirrorKey(chatId: string | number, threadId: number): string {
  return `${chatId}:${threadId}`;
}

/** Load before the bot handles updates, including native commands that inspect routes synchronously. */
export async function loadContactTopicMirrors(accountId: string): Promise<void> {
  const state = accountMirrors(accountId);
  if (state.loaded) return;
  state.loading ??= (async () => {
    for (const { key, value } of await state.store.entries()) {
      if (value && typeof value.sessionKey === "string" && value.sessionKey.startsWith("agent:")) {
        state.rows.set(key, value);
      }
    }
    state.loaded = true;
  })().finally(() => { state.loading = undefined; });
  await state.loading;
}

export async function recordContactTopicMirror(params: {
  accountId: string;
  chatId: string | number;
  threadId: number;
  sessionKey: string;
}): Promise<void> {
  await loadContactTopicMirrors(params.accountId);
  const state = accountMirrors(params.accountId);
  const key = mirrorKey(params.chatId, params.threadId);
  const value = { sessionKey: params.sessionKey };
  await state.store.register(key, value);
  state.rows.set(key, value);
}

export function peekContactTopicMirror(params: {
  accountId: string;
  chatId: string | number;
  threadId: number;
}): string | undefined {
  return accountMirrors(params.accountId).rows.get(mirrorKey(params.chatId, params.threadId))?.sessionKey;
}

export async function resolveContactTopicMirror(params: {
  accountId: string;
  chatId: string | number;
  threadId: number;
}): Promise<string | undefined> {
  await loadContactTopicMirrors(params.accountId);
  return peekContactTopicMirror(params);
}

export function resetContactTopicMirrorsForTest(): void {
  resolveGlobalSingleton(stateKey, () => new Map<string, AccountMirrors>()).clear();
}
