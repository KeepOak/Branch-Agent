import type { TrunkToolsOptions } from "./trunk-tools.js";

export type Rec = Record<string, unknown>;
export type Who = { id: string; name: string };
export const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
export const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
export const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);

/** Who a hub write is attributed to: the grafted agent, else plain Graft. */
export async function who(opts: TrunkToolsOptions): Promise<Who> {
  const agent = await opts.outsideAgent();
  return agent ? { id: agent.id, name: agent.name } : { id: "graft", name: "Graft" };
}
