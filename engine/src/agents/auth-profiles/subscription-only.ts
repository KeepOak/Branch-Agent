import type { BranchConfig } from "../../config/types.branch.js";
import { findPersistedAuthProfileCredential, getRuntimeAuthProfileStoreSnapshot } from "./store.js";

/** Agent-made sign-in changes may only land on subscription (oauth or token) sign-ins. */
export const SUBSCRIPTION_ONLY_SIGN_IN_MESSAGE = "Trunks only use subscription sign-ins.";

/** Unpinned agent runs never fall back to a stored API key. */
export const SUBSCRIPTION_ONLY_RUN_MESSAGE = `${SUBSCRIPTION_ONLY_SIGN_IN_MESSAGE} This provider only has API-key sign-ins; add a subscription sign-in in Model Setup. Branch Agent did not start the run.`;

/**
 * The one reader of agents.defaults.subscriptionsOnly. Off (the default) keeps upstream OpenClaw
 * behaviour: API-key sign-ins are ordinary candidates for unpinned runs, auth order, session
 * patches and rate-limit switching. On restores the subscription-only rules the guards enforce.
 */
export function isSubscriptionsOnly(cfg: BranchConfig | undefined): boolean {
  return cfg?.agents?.defaults?.subscriptionsOnly === true;
}

/** Reads the stored credential type for a profile, preferring the live runtime snapshot. */
export function isApiKeyAuthProfile(params: { agentDir: string; profileId: string }): boolean {
  const credential =
    getRuntimeAuthProfileStoreSnapshot(params.agentDir)?.profiles[params.profileId] ??
    findPersistedAuthProfileCredential(params);
  return credential?.type === "api_key";
}
