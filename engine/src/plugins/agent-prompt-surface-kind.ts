import type { AgentPromptSurfaceKind } from "./types.js";

/** Normalizes legacy prompt surface names to current Branch Agent surface names. */
export function normalizeAgentPromptSurfaceKind(
  surface: AgentPromptSurfaceKind,
): AgentPromptSurfaceKind {
  return surface === "pi_main" ? "branch_main" : surface;
}

/** True when a prompt surface targets the main Branch Agent prompt. */
export function isBranchMainPromptSurface(surface: AgentPromptSurfaceKind): boolean {
  return normalizeAgentPromptSurfaceKind(surface) === "branch_main";
}
