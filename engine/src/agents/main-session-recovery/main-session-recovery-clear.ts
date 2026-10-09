import type { InternalSessionEntry as SessionEntry } from "../../config/sessions.js";

type ForegroundClaims = NonNullable<
  NonNullable<SessionEntry["mainRestartRecovery"]>["foregroundClaims"]
>;

export function removeMainSessionRecoveryForegroundClaim(
  claims: ForegroundClaims,
  claimId: string,
): ForegroundClaims | undefined {
  const tokens = claims.tokens.filter((token) => token !== claimId);
  if (tokens.length === 0) {
    return undefined;
  }
  const runIdsByClaimId = Object.fromEntries(
    Object.entries(claims.runIdsByClaimId ?? {}).filter(([token]) => token !== claimId),
  );
  return {
    lifecycleGeneration: claims.lifecycleGeneration,
    tokens,
    ...(Object.keys(runIdsByClaimId).length > 0 ? { runIdsByClaimId } : {}),
  };
}

type MainRecoveryStateFields = Pick<
  SessionEntry,
  "abortedLastRun" | "restartRecoveryRuns" | "mainRestartRecovery" | "restartRecoveryRetryAtMs"
>;

// restartRecoveryDeliveryRunId stays out of this patch: it keys delivery-claim
// adoption (agent-command-restart-recovery.ts), not recovery ownership, and
// clearing it here strands the paired delivery context on the successor entry.
export const MAIN_SESSION_RECOVERY_CLEAR_PATCH: Partial<MainRecoveryStateFields> = {
  abortedLastRun: false,
  restartRecoveryRuns: undefined,
  mainRestartRecovery: undefined,
};

export function buildMainSessionRecoveryClearPatch(
  entry?: Partial<MainRecoveryStateFields> | null,
): Partial<MainRecoveryStateFields> {
  if (
    entry?.abortedLastRun !== true &&
    entry?.restartRecoveryRuns === undefined &&
    entry?.mainRestartRecovery === undefined &&
    entry?.restartRecoveryRetryAtMs === undefined
  ) {
    return {};
  }
  return entry?.restartRecoveryRetryAtMs === undefined
    ? MAIN_SESSION_RECOVERY_CLEAR_PATCH
    : { ...MAIN_SESSION_RECOVERY_CLEAR_PATCH, restartRecoveryRetryAtMs: undefined };
}

export function clearMainSessionRecoveryAfterAgentRun(
  entry: SessionEntry,
  clearForceSafeTools: boolean | undefined,
): void {
  if (entry.abortedLastRun === true) {
    return;
  }
  if (clearForceSafeTools) {
    entry.restartRecoveryForceSafeTools = undefined;
  }
  Object.assign(entry, buildMainSessionRecoveryClearPatch(entry));
}

export type { MainRecoveryStateFields };
