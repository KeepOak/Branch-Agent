/**
 * Prompt-surface helpers for Branch Agent tool guidance.
 *
 * Maps runtime/session surfaces to the fallback tool text and workflow hints that belong in prompts.
 */
import { isBranchMainPromptSurface } from "../plugins/agent-prompt-surface-kind.js";
import type { AgentPromptSurfaceKind } from "../plugins/types.js";
import { isAcpSessionKey, isSubagentSessionKey } from "../routing/session-key.js";

/** Builds fallback tool guidance when a runtime cannot render the structured tool list. */
export function buildBranchToolFallbackText(params: { surface: AgentPromptSurfaceKind }): string {
  if (isBranchMainPromptSurface(params.surface)) {
    return "The active runtime provides the available Branch Agent tools directly. Use only exposed tools; names are case-sensitive.";
  }

  return "No Branch Agent tool list is injected for this runtime prompt surface. Use only tools exposed directly by the active backend.";
}

/** Maps a session key to the prompt surface used for tool guidance and runtime behavior. */
export function resolveAgentPromptSurfaceForSessionKey(
  sessionKey?: string,
): AgentPromptSurfaceKind {
  if (sessionKey && isAcpSessionKey(sessionKey)) {
    return "acp_backend";
  }
  return sessionKey && isSubagentSessionKey(sessionKey) ? "subagent" : "branch_main";
}
