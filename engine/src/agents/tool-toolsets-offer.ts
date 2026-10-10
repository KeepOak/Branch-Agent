/**
 * Which toolsets a Trunk's own tool list still offers. The caller passes the effective
 * policy layers (profile, global and agent allow and deny) without the Trunk's own toolset
 * switches, so a switch shows what the rest of the configuration allows.
 */
import type { SandboxToolPolicy } from "./sandbox.js";
import { isToolAllowedByPolicies } from "./tool-policy-match.js";
import { TOOLSETS, type ToolsetDefinition } from "./tool-toolsets.js";

/** The tools of one toolset that the given policy layers offer. */
export function offeredToolsetTools(
  toolset: ToolsetDefinition,
  policies: ReadonlyArray<SandboxToolPolicy | undefined>,
): string[] {
  return toolset.tools.filter((tool) => isToolAllowedByPolicies(tool, [...policies]));
}

/** For each toolset id: whether the policy layers offer at least one of its tools. */
export function resolveToolsetOffers(
  policies: ReadonlyArray<SandboxToolPolicy | undefined>,
  toolsets: readonly ToolsetDefinition[] = TOOLSETS,
): Record<string, boolean> {
  return Object.fromEntries(
    toolsets.map((toolset) => [toolset.id, offeredToolsetTools(toolset, policies).length > 0]),
  );
}
