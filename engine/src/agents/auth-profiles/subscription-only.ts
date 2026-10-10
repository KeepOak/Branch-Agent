import { findPersistedAuthProfileCredential, getRuntimeAuthProfileStoreSnapshot } from "./store.js";

/** Agent-made sign-in changes may only land on subscription (oauth or token) sign-ins. */
export const SUBSCRIPTION_ONLY_SIGN_IN_MESSAGE = "Trunks only use subscription sign-ins.";

/** Unpinned agent runs never fall back to a stored API key. */
export const SUBSCRIPTION_ONLY_RUN_MESSAGE = `${SUBSCRIPTION_ONLY_SIGN_IN_MESSAGE} This provider only has API-key sign-ins; add a subscription sign-in in Model Setup. Branch Agent did not start the run.`;

/** Reads the stored credential type for a profile, preferring the live runtime snapshot. */
export function isApiKeyAuthProfile(params: { agentDir: string; profileId: string }): boolean {
  const credential =
    getRuntimeAuthProfileStoreSnapshot(params.agentDir)?.profiles[params.profileId] ??
    findPersistedAuthProfileCredential(params);
  return credential?.type === "api_key";
}
