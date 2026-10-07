// The Trunk family's data: agents.list rows, the agent's config entry and the looks with real art.
// Contracts: engine/packages/gateway-protocol/src/schema/agents-models-skills.ts (AgentSummary, agents.update),
// engine/src/config/zod-schema.agents.ts (agents.entries, default, ownership) and zod-schema.agent-runtime.ts (tools).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { CHARACTERS, EXTRA, trunkAppearance } from "../../face/appearance";

export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export type TrunkRow = {
  id: string;
  name: string;
  theme: string;
  emoji: string;
  avatar: string;
  colour: string;
  shape: string;
  eyes: string;
  model: string;
  workspace: string;
  createdVia: string;
  creatorAgentId: string;
  runtime: string;
};
export type Roster = { defaultId: string; mainKey: string; ownership: string; agents: TrunkRow[] };

function readRow(a: Rec): TrunkRow {
  const identity = rec(a.identity);
  return {
    id: str(a.id),
    name: str(identity.name) || str(a.name) || str(a.id),
    theme: str(identity.theme),
    emoji: str(identity.emoji),
    avatar: str(identity.avatar),
    colour: str(identity.colour),
    shape: str(identity.shape),
    eyes: str(identity.eyes),
    model: str(rec(a.model).primary),
    workspace: str(a.workspace),
    createdVia: str(a.createdVia),
    creatorAgentId: str(a.creatorAgentId),
    runtime: str(rec(a.agentRuntime).id),
  };
}

/** agents.list, read defensively. */
export function readRoster(result: unknown): Roster {
  const r = rec(result);
  const agents = (Array.isArray(r.agents) ? r.agents : []).map(rec).filter((a) => str(a.id) && str(a.kind) !== "system").map(readRow);
  return { defaultId: str(r.defaultId), mainKey: str(r.mainKey) || "main", ownership: str(r.ownership), agents };
}

/** The conversation key of a Trunk's main conversation (agent:<id>:<mainKey>). */
export const mainKeyOf = (roster: Roster, id: string) => `agent:${id}:${roster.mainKey}`;

/* ---------- looks: only those with real art (face/appearance.tsx), plus the classic pebble ---------- */
const LOOK_NAMES: Record<string, string> = {
  ember: "Ember", tock: "Tock", kite: "Kite", morel: "Morel", pebble: "Cobble", wisp: "Wisp", lumen: "Lumen",
  tide: "Tide", juniper: "Juniper", bolt: "Bolt", sorrel: "Sorrel", skein: "Skein", nib: "Nib",
};
const LOOK_ORDER = ["ember", "tock", "kite", "morel", "pebble", "wisp", "lumen", "tide", "juniper", "bolt", "sorrel", "skein", "nib"];
export type Look = { id: string; name: string; still: string | null; later: boolean };
export const LOOKS: Look[] = [
  { id: "classic", name: "Classic pebble", still: null, later: false },
  { id: "branch", name: "Branch", still: "/assets/branch-wave.webp", later: false },
  ...LOOK_ORDER.filter((id) => CHARACTERS.includes(id) || EXTRA.includes(id)).map((id) => ({
    id,
    name: LOOK_NAMES[id] ?? id,
    still: trunkAppearance(`branch:${id}`, "")?.still ?? null,
    later: EXTRA.includes(id),
  })),
];
export const EMOJI = ["🦊", "🦉", "🐢", "🍄", "🌿", "🐝", "🦔", "🐙", "🌻", "🪴", "🐧", "🦜"];

/** The look a Trunk wears now: the character its avatar names (or the window's default for it), else the pebble. */
export function lookOf(avatar: string, name: string): string {
  if (avatar === "branch:branch") return "branch";
  const still = trunkAppearance(avatar || undefined, name)?.still ?? "";
  const id = /\/agents\/([^/]+)\/still\.webp$/.exec(still)?.[1];
  return id && LOOKS.some((l) => l.id === id) ? id : "classic";
}
/** The avatar value agents.update stores for a look ("classic" keeps the pebble even where a default look exists). */
export const avatarFor = (look: string) => (look === "classic" ? "classic" : `branch:${look}`);

/* ---------- the config entry (config.get → agents.entries.<id>) ---------- */
export type ConfigSnapshot = { hash: string; valid: boolean; config: Rec };
export function readConfig(result: unknown): ConfigSnapshot {
  const r = rec(result);
  return { hash: str(r.hash), valid: r.valid !== false, config: rec(r.config) };
}
export const entryOf = (snap: ConfigSnapshot, id: string): Rec => rec(rec(rec(snap.config.agents).entries)[id]);
export const agentDefaults = (snap: ConfigSnapshot): Rec => rec(rec(snap.config.agents).defaults);

/** Builds { a: { b: value } } from "a.b" paths, as config.patch's merge patch takes it. */
export function mergePatch(changes: Record<string, unknown>): Rec {
  const patch: Rec = {};
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let target = patch;
    for (const key of keys.slice(0, -1)) {
      target[key] = rec(target[key]);
      target = target[key] as Rec;
    }
    target[keys[keys.length - 1]] = value;
  }
  return patch;
}

/** Sends one config.patch against the snapshot's revision; refuses a stale or invalid configuration. */
export async function patchConfig(engine: { request<T>(m: string, p?: unknown): Promise<T> }, snap: ConfigSnapshot, changes: Record<string, unknown>) {
  if (!snap.hash) throw new Error("The engine did not provide a configuration revision. Refresh before saving.");
  if (!snap.valid) throw new Error("The engine configuration is invalid. Resolve its validation errors before saving.");
  const result = rec(await engine.request("config.patch", { baseHash: snap.hash, raw: JSON.stringify(mergePatch(changes)) }));
  if (result.ok === false) throw new Error(str(rec(result.error).message) || str(result.error) || "The engine did not save the change.");
  return result;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Creation errors are for people naming a Trunk, not engine IDs. */
export const creationProblem = (error: unknown) => {
  const message = errorText(error);
  if (/reserved/i.test(message)) return "That name is kept for Branch. Choose another Trunk name.";
  if (/invalid|no valid id characters/i.test(message)) return "Use a name with at least one letter or number.";
  return "Couldn’t create your Trunk. Try again.";
};
