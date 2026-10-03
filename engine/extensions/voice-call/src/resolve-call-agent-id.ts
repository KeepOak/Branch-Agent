import { resolveDefaultAgentId } from "branch/plugin-sdk/agent-scope-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { normalizeAgentId } from "branch/plugin-sdk/routing";
import type { VoiceCallConfig } from "./config.js";
import type { CallRecord } from "./types.js";

/** Setup and startup must resolve the same owner before provisioning telephony. */
export function resolveVoiceCallAgentId(
  config: Pick<VoiceCallConfig, "agentId">,
  coreConfig: BranchConfig,
): string {
  return config.agentId
    ? normalizeAgentId(config.agentId)
    : resolveDefaultAgentId(coreConfig, {
        surface: "Voice Call",
        hint: "Set plugins.entries.voice-call.config.agentId to a configured agent ID.",
      });
}

/** Keep one agent owner for the full call, including legacy stored records. */
export function resolveCallAgentId(
  call: Pick<CallRecord, "agentId">,
  config: Pick<VoiceCallConfig, "agentId">,
): string {
  return normalizeAgentId(call.agentId ?? config.agentId);
}
