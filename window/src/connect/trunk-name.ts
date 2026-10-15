// A Trunk's name as a person reads it. The engine keys the default Trunk by the id "main"; that id is never shown.
// The default Trunk with no name of its own reads as Sapling. Any other Trunk with no name reads as the plain word
// "Trunk", so a Trunk someone already has stays listed and reachable.

/** The engine's id for the default Trunk (its main conversation is agent:main:main). */
export const DEFAULT_TRUNK_ID = "main";
/** The product's name for the default Trunk (preview.html:8162, ONBOARDING-PROPOSAL step ④). */
export const DEFAULT_TRUNK_NAME = "Sapling";
/** The preview's plain word for a Trunk, used only when a Trunk's record has no id to read from. */
export const PLAIN_TRUNK_NAME = "Trunk";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A Trunk's own name: its identity name, else its name, else "". */
function ownName(agent: unknown): string {
  const a = rec(agent);
  return str(rec(a.identity).name) || str(a.name);
}

/** A Trunk's title as a person reads it: the engine's id (the default Trunk is "main") and a name that is only the id read as
 *  the Trunk's display name. Every place that shows a Trunk's main conversation uses this. */
export function displayTrunkTitle(title: string, agentId: string): string {
  return !title || title === agentId ? trunkDisplayName({ id: agentId }) : title;
}

/** An agents.list entry's display name: its own name, else the default Trunk's name, else the plain word "Trunk". */
export function trunkDisplayName(agent: unknown): string {
  const name = ownName(agent);
  if (name) return name;
  return str(rec(agent).id) === DEFAULT_TRUNK_ID ? DEFAULT_TRUNK_NAME : PLAIN_TRUNK_NAME;
}

/** The name of the Trunk that owns a conversation key (agent:<id>:<rest>), read from an agents.list result; the fallback
 *  when the key names no listed Trunk. A conversation's Trunk is its own, not the default Trunk. */
export function trunkNameForKey(agents: unknown, key: string | null | undefined, fallback: string): string {
  const id = key?.split(":")[1];
  if (!id) return fallback;
  const list = Array.isArray(rec(agents).agents) ? (rec(agents).agents as unknown[]) : [];
  const agent = list.find((a) => str(rec(a).id) === id);
  return agent ? trunkDisplayName(agent) : fallback;
}
