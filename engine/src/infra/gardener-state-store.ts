// Gardener state in the engine's existing state database (plugin-state keyed store). A restart keeps the rate-limit
// stamp and the cooldowns, which is what makes the cooldown real across processes.
import { createCorePluginStateSyncKeyedStore } from "../plugin-state/plugin-state-store.js";
import type { GardenerStateStore } from "./gardener-pass.js";

const OWNER_ID = "core:gardener";
const NAMESPACE = "gardener-state";
const MAX_ENTRIES = 1_000;
const LAST_RUN_KEY = "last-run-at";
const issueKey = (fingerprint: string) => `issue:${fingerprint}`;

export function openGardenerStateStore(env?: NodeJS.ProcessEnv): GardenerStateStore {
  const store = createCorePluginStateSyncKeyedStore<number>({
    ownerId: OWNER_ID,
    namespace: NAMESPACE,
    maxEntries: MAX_ENTRIES,
    overflowPolicy: "evict-oldest",
    ...(env ? { env } : {}),
  });
  const cooldownKey = (fingerprint: string) => `cooldown:${fingerprint}`;
  return {
    lastRunAt: () => store.lookup(LAST_RUN_KEY),
    setLastRunAt: (at) => {
      store.register(LAST_RUN_KEY, at);
    },
    cooldownUntil: (fingerprint) => store.lookup(cooldownKey(fingerprint)),
    issueNumber: (fingerprint) => store.lookup(issueKey(fingerprint)),
    setIssueNumber: (fingerprint, issueNumber) => {
      store.register(issueKey(fingerprint), issueNumber);
    },
    setCooldownUntil: (fingerprint, until, ttlMs) => {
      store.register(cooldownKey(fingerprint), until, { ttlMs });
    },
  };
}
