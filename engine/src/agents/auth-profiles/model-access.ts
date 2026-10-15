import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthProfileStore } from "./types.js";

const probing = new AsyncLocalStorage<boolean>();
export function withModelAccessProbe<T>(run: () => T): T {
  return probing.run(true, run);
}

export const MODEL_ACCESS_INTERVAL_MS = 3 * 60 * 60_000;

/** Unknown and stale checks are not proof of subscription access. */
export function isModelAccessUsable(
  store: AuthProfileStore,
  profileId: string,
  provider: string,
  model: string,
  now = Date.now(),
): boolean {
  const check = store.usageStats?.[profileId]?.modelAccess?.[`${provider}/${model}`];
  return Boolean(
    check?.usable && check.checkedAt <= now && now - check.checkedAt < MODEL_ACCESS_INTERVAL_MS,
  );
}

/** Leave unprobed ordinary routes alone; a recorded refusal never becomes permission by aging. */
export function isModelAccessDenied(
  store: AuthProfileStore,
  profileId: string,
  provider: string,
  model: string,
): boolean {
  if (probing.getStore()) {
    return false;
  }
  return store.usageStats?.[profileId]?.modelAccess?.[`${provider}/${model}`]?.usable === false;
}
