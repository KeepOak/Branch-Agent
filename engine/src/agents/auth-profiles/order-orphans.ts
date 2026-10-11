import type { AuthProfileStore } from "./types.js";

/** One provider's order row and the profile ids it names that the store does not hold. */
export type AuthOrderMissingProfiles = Readonly<{
  provider: string;
  profileIds: readonly string[];
}>;

/**
 * Order rows that name profiles absent from the agent's effective (own plus inherited) store.
 * Selection already skips those ids; callers report them so a stale row stays visible instead
 * of silently narrowing the agent's failover order.
 */
export function listAuthOrderProfilesMissingFromStore(
  store: Pick<AuthProfileStore, "order" | "profiles"> | undefined,
): AuthOrderMissingProfiles[] {
  if (!store?.order) {
    return [];
  }
  const missing: AuthOrderMissingProfiles[] = [];
  for (const [provider, profileIds] of Object.entries(store.order)) {
    const absent = (Array.isArray(profileIds) ? profileIds : []).filter(
      (profileId) => !Object.hasOwn(store.profiles, profileId),
    );
    if (absent.length > 0) {
      missing.push({ provider, profileIds: [...new Set(absent)] });
    }
  }
  return missing.toSorted((left, right) => left.provider.localeCompare(right.provider));
}

/** Operator-facing warning for order rows that name absent profiles. */
export function formatAuthOrderMissingProfilesWarning(
  agentId: string,
  missing: readonly AuthOrderMissingProfiles[],
): string {
  const rows = missing
    .map((row) => row.provider + "=[" + row.profileIds.join(", ") + "]")
    .join("; ");
  return (
    "agent " +
    agentId +
    " auth order names profiles absent from its auth store; model selection skips them: " +
    rows +
    ". Fix with branch models auth order set|clear --agent " +
    agentId +
    " --provider <provider>."
  );
}
