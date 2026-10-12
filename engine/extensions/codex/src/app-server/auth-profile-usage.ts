import {
  markAuthProfileFailure,
  markAuthProfileSuccess,
  resolveAuthProfileFailureReason,
  resolveFailoverReasonFromError,
  type AuthProfileStore,
} from "branch/plugin-sdk/provider-auth";
import { embeddedAgentLog, formatErrorMessage } from "branch/plugin-sdk/agent-harness-runtime";

/** The Codex app-server selects auth after the embedded runner's auth boundary. */
export async function recordCodexAuthProfileOutcome(params: {
  authProfileId?: string;
  store?: AuthProfileStore;
  agentDir?: string;
  modelId: string;
  runId: string;
  succeeded: boolean;
  error?: unknown;
  providerStarted?: boolean;
  stateMode?: "read-write" | "read-only";
}): Promise<void> {
  const profileId = params.authProfileId?.trim();
  const store = params.store;
  if (params.stateMode === "read-only" || !profileId || !store?.profiles[profileId]) {
    return;
  }
  try {
    if (params.succeeded) {
      if (!params.providerStarted) return;
      await markAuthProfileSuccess({
        store,
        provider: store.profiles[profileId].provider,
        profileId,
        agentDir: params.agentDir,
      });
      return;
    }
    const reason = resolveAuthProfileFailureReason({
      failoverReason: resolveFailoverReasonFromError(params.error, "openai"),
      providerStarted: params.providerStarted,
    });
    if (reason) {
      await markAuthProfileFailure({
        store,
        profileId,
        reason,
        agentDir: params.agentDir,
        runId: params.runId,
        modelId: params.modelId,
      });
    }
  } catch (error) {
    // Auth bookkeeping must not turn an otherwise completed model turn into a failure.
    embeddedAgentLog.warn("codex auth-profile bookkeeping failed", {
      runId: params.runId,
      error: formatErrorMessage(error),
    });
  }
}
