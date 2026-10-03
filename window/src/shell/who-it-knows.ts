// "Who it knows" (DESIGN-SPEC §4.2.4 spec change): the other Trunks this Trunk may talk to, read from the engine's
// agent-to-agent policy (tools.agentToAgent) the way engine/src/plugin-sdk/session-visibility.ts
// createAgentToAgentPolicy decides it: on unless enabled is false; an empty allow list permits every pair; a blank
// entry denies; "*" matches any part of the id, case-insensitively.
export type AgentToAgent = { enabled?: unknown; allow?: unknown };

function matches(pattern: string, agentId: string): boolean {
  const raw = pattern.trim();
  if (!raw) return false;
  if (raw === "*") return true;
  if (!raw.includes("*")) return raw === agentId;
  const parts = raw.toLowerCase().split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*")}$`).test(agentId.toLowerCase());
}

/** Whether `from` may talk to `to` under the policy. */
export function mayTalk(policy: AgentToAgent | undefined, from: string, to: string): boolean {
  if (from === to) return true;
  if (policy?.enabled === false) return false;
  const allow = Array.isArray(policy?.allow) ? policy.allow.filter((p): p is string => typeof p === "string") : [];
  const ok = (id: string) => allow.length === 0 || allow.some((p) => matches(p, id));
  return ok(from) && ok(to);
}

/** The Trunks, other than this one, that this one may talk to, in the list's order. */
export function knownTrunks<T extends { id: string }>(policy: AgentToAgent | undefined, self: string, trunks: readonly T[]): T[] {
  return trunks.filter((t) => t.id !== self && mayTalk(policy, self, t.id));
}
