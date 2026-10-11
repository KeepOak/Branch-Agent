import type { PreparedModelRuntimeInput } from "../agents/prepared-model-runtime.js";
import { formatErrorMessage } from "../infra/errors.js";

/**
 * Reports order rows that name profiles absent from the agent's published (effective) auth
 * store. Selection already skips those ids, so they never block publication; the warning keeps
 * a stale row, such as one written before its profiles moved to the auth owner, visible.
 * Reporting never fails the startup attempt.
 */
export async function reportStartupAuthOrderMissingProfiles(
  agentId: string,
  input: PreparedModelRuntimeInput,
  log: { warn: (message: string) => void },
): Promise<void> {
  try {
    const [
      { getPreparedModelRuntimeSnapshot },
      { getPreparedModelRuntimeAuthStore },
      { formatAuthOrderMissingProfilesWarning, listAuthOrderProfilesMissingFromStore },
    ] = await Promise.all([
      import("../agents/prepared-model-runtime.js"),
      import("../agents/prepared-model-runtime-auth.js"),
      import("../agents/auth-profiles/order-orphans.js"),
    ]);
    const snapshot = getPreparedModelRuntimeSnapshot(input);
    const missing = listAuthOrderProfilesMissingFromStore(
      snapshot ? getPreparedModelRuntimeAuthStore(snapshot) : undefined,
    );
    if (missing.length > 0) {
      log.warn(formatAuthOrderMissingProfilesWarning(agentId, missing));
    }
  } catch (error) {
    log.warn("agent " + agentId + " auth order check failed: " + formatErrorMessage(error));
  }
}
