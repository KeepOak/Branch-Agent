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

/** An agents.list entry's display name: its own name, else the default Trunk's name, else the plain word "Trunk". */
export function trunkDisplayName(agent: unknown): string {
  const name = ownName(agent);
  if (name) return name;
  return str(rec(agent).id) === DEFAULT_TRUNK_ID ? DEFAULT_TRUNK_NAME : PLAIN_TRUNK_NAME;
}
