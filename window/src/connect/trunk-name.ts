// A Trunk's name as a person reads it. The engine keys the default Trunk by the id "main"; that id is never shown.
// A Trunk with no name of its own shows the product's name for the default Trunk, or a plain placeholder.

/** The engine's id for the default Trunk (its main conversation is agent:main:main). */
export const DEFAULT_TRUNK_ID = "main";
/** The product's name for the default Trunk (preview.html:8162, ONBOARDING-PROPOSAL step ④). */
export const DEFAULT_TRUNK_NAME = "Sapling";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** An agents.list entry's display name: its identity name, else its name, else the default Trunk's name. */
export function trunkDisplayName(agent: unknown): string {
  const a = rec(agent);
  const name = str(rec(a.identity).name) || str(a.name);
  if (name) return name;
  return str(a.id) === DEFAULT_TRUNK_ID ? DEFAULT_TRUNK_NAME : "Untitled Trunk";
}
