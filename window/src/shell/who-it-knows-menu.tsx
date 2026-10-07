import { Face } from "../face/Face";
import { notify } from "./notify";
import type { MenuItem } from "./Menu";
import { mayTalk, type AgentToAgent, type PerAgent } from "./who-it-knows";

type Trunk = { id: string; name: string; theme?: string; isDefault?: boolean };
type Request = (method: string, params: unknown) => Promise<unknown>;
const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";

/** Both directions use the same engine policy, but each switch changes only its requester's deny list. */
export async function whoItKnowsItems(request: Request, self: Trunk, trunks: readonly Trunk[]): Promise<MenuItem[]> {
  const snapshot = rec(await request("config.get", {}));
  const cfg = rec(snapshot.config);
  const policy = rec(rec(cfg.tools).agentToAgent) as AgentToAgent;
  const entries = rec(rec(cfg.agents).entries) as PerAgent;
  const others = trunks.filter((t) => t.id !== self.id);
  if (policy.enabled === false) return [
    { kind: "head", label: `${self.name} knows and may talk to` },
    { kind: "info", label: "No other Trunk: talking between Trunks is off." },
  ];
  if (!others.length) return [
    { kind: "head", label: `${self.name} knows and may talk to` },
    { kind: "info", label: "No other Trunk yet." },
  ];
  const switchFor = (from: Trunk, to: Trunk): MenuItem => {
    const canEnable = (all: PerAgent, rule: AgentToAgent) => {
      const pair = all[from.id]?.agentToAgent;
      const deny = Array.isArray(pair?.deny) ? pair.deny.filter((v): v is string => typeof v === "string") : [];
      return mayTalk(rule, { ...all, [from.id]: { agentToAgent: { ...pair, deny: deny.filter((id) => id !== to.id) } } }, from.id, to.id);
    };
    return {
      label: from.id === self.id ? to.name : from.name,
      sub: from.id === self.id ? to.theme || (to.isDefault ? "Your default Trunk" : undefined) : `${from.name} may message ${to.name}`,
      icon: <Face size={26} label={from.id === self.id ? to.name : from.name} />,
      checked: mayTalk(policy, entries, from.id, to.id),
      disabled: canEnable(entries, policy) ? undefined : "Another agent-to-agent rule blocks this Trunk.",
      run: () => void (async () => {
        try {
          const fresh = rec(await request("config.get", {}));
          const freshCfg = rec(fresh.config);
          const freshPolicy = rec(rec(freshCfg.tools).agentToAgent) as AgentToAgent;
          const freshEntries = rec(rec(freshCfg.agents).entries) as PerAgent;
          const pair = freshEntries[from.id]?.agentToAgent;
          const existing = Array.isArray(pair?.deny) ? pair.deny.filter((v): v is string => typeof v === "string") : [];
          if (!canEnable(freshEntries, freshPolicy)) throw new Error("Another agent-to-agent rule blocks this Trunk.");
          const turningOff = mayTalk(freshPolicy, freshEntries, from.id, to.id);
          const deny = turningOff ? [...existing, to.id] : existing.filter((id) => id !== to.id);
          const result = rec(await request("config.patch", { baseHash: fresh.hash, raw: JSON.stringify({ agents: { entries: { [from.id]: { agentToAgent: { deny } } } } }) }));
          if (result.ok === false) throw new Error(str(rec(result.error).message) || "The engine did not save the change.");
          notify(turningOff ? "It won't message them." : "It can reach them now.");
        } catch (e) { notify(e instanceof Error ? e.message : String(e), { tone: "bad" }); }
      })(),
    };
  };
  return [
    { kind: "head", label: `${self.name} knows and may talk to` },
    ...others.map((to) => switchFor(self, to)),
    { kind: "sep" },
    { kind: "head", label: `May message ${self.name}` },
    ...others.map((from) => switchFor(from, self)),
  ];
}
