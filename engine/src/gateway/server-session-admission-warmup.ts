import { listAgentIds } from "../agents/agent-scope-config.js";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";

export async function warmAgentSessionAdmission(
  agentId: string,
  cfg: BranchConfig,
  signal?: AbortSignal,
): Promise<void> {
  const { loadSessionEntryForAdmission } =
    await import("../config/sessions/session-accessor.sqlite-entry.js");
  const admission = await loadSessionEntryForAdmission(
    {
      agentId,
      sessionKey: resolveAgentMainSessionKey({ cfg, agentId }),
      readConsistency: "latest",
    },
    { signal },
  );
  await admission.databaseClaim.release();
}

/** Prepare cold session workers after readiness without delaying the listener or a create RPC. */
export function startGatewaySessionAdmissionWarmup(params: {
  cfg: BranchConfig;
  signal: AbortSignal;
  warn: (message: string) => void;
}): { stop: () => Promise<void> } {
  const work = Promise.resolve().then(async () => {
    for (const agentId of listAgentIds(params.cfg)) {
      if (params.signal.aborted) {
        break;
      }
      try {
        await warmAgentSessionAdmission(agentId, params.cfg, params.signal);
      } catch (error) {
        if (!params.signal.aborted) {
          params.warn(
            `agent ${agentId} session admission warm-up failed: ${formatErrorMessage(error)}`,
          );
        }
      }
    }
  });
  return { stop: () => work };
}
