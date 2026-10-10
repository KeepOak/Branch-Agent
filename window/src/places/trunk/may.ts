// "What it may do" and "Its computers", read from and written to the Trunk's config entry
// (engine/src/config/zod-schema.agent-runtime.ts: tools.fs.workspaceOnly, tools.deny, tools.exec.host/node,
// decisionModel; zod-schema.agent-model.ts: model { primary, fallbacks }).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { agentDefaults, entryOf, rec, str, strs, type ConfigSnapshot } from "./model";

export type May = {
  read: boolean;
  /** Browser on: the browser toolset is on and no deny or rule for every Trunk turns it off. */
  browse: boolean;
  /** Why the browser switch can't change here (a rule for every Trunk, or its own tool list). */
  browseLock: string;
  /** Toolset switches the entry sets explicitly. A missing name is on. Browser is read through `browse`. */
  toolsets: Record<string, boolean>;
  decide: string;
  fallbacks: string[];
  startOn: string;
};

const BROWSER = ["browser", "group:ui"];
const blocks = (list: string[]) => list.some((t) => BROWSER.includes(t));
/** The entry's explicit true/false toolset switches; anything else is left to the default (on). */
const switchesOf = (value: unknown): Record<string, boolean> =>
  Object.fromEntries(Object.entries(rec(value)).filter((pair): pair is [string, boolean] => typeof pair[1] === "boolean"));

/** The current values, so every switch starts where the engine is. */
export function readMay(snap: ConfigSnapshot, id: string): May {
  const entry = entryOf(snap, id), tools = rec(entry.tools), globalTools = rec(snap.config.tools);
  const workspaceOnly = rec(tools.fs).workspaceOnly ?? rec(globalTools.fs).workspaceOnly;
  const allow = strs(tools.allow);
  const browseLock = blocks(strs(globalTools.deny))
    ? "Turned off for every Trunk in the engine’s tool settings."
    : allow.length && !allow.includes("*") && !blocks(allow)
      ? "Its own tool list leaves the browser out. Change it in the engine’s tool settings."
      : "";
  const toolsets = switchesOf(entry.toolsets);
  const exec = rec(tools.exec);
  const groupLock = strs(tools.deny).includes("group:ui") ? "Its own tool list turns off the screen tools, the browser with them. Change it in the engine’s tool settings." : "";
  return {
    read: workspaceOnly !== true,
    browse: !browseLock && !groupLock && !blocks(strs(tools.deny)) && toolsets.browser !== false,
    browseLock: browseLock || groupLock,
    toolsets,
    decide: entry.decisionModel === undefined ? "same" : str(entry.decisionModel) || "none",
    fallbacks: strs(rec(entry.model).fallbacks),
    startOn: str(exec.host) === "node" && str(exec.node) ? str(exec.node) : "this",
  };
}

/** The config.patch paths for what changed between `was` and `now`; empty when nothing did. */
export function mayChanges(snap: ConfigSnapshot, id: string, was: May, now: May, model: string): Record<string, unknown> {
  const base = `agents.entries.${id}`, tools = rec(entryOf(snap, id).tools), out: Record<string, unknown> = {};
  const everyTrunk = rec(rec(snap.config.tools).fs).workspaceOnly === true;
  if (was.read !== now.read) out[`${base}.tools.fs.workspaceOnly`] = now.read ? (everyTrunk ? false : null) : true;
  if (was.browse !== now.browse) {
    out[`${base}.toolsets.browser`] = now.browse ? null : false;
    const deny = strs(tools.deny);
    const cleaned = deny.filter((t) => t !== "browser");
    if (now.browse && cleaned.length !== deny.length) out[`${base}.tools.deny`] = cleaned.length ? cleaned : null;
  }
  for (const id of new Set([...Object.keys(was.toolsets), ...Object.keys(now.toolsets)])) {
    if (id === "browser" || (was.toolsets[id] !== false) === (now.toolsets[id] !== false)) continue;
    out[`${base}.toolsets.${id}`] = now.toolsets[id] === false ? false : null;
  }
  if (was.decide !== now.decide) out[`${base}.decisionModel`] = now.decide === "same" ? null : now.decide === "none" ? "" : now.decide;
  if (was.fallbacks.join("\n") !== now.fallbacks.join("\n")) out[`${base}.model`] = { primary: model || null, fallbacks: now.fallbacks.length ? now.fallbacks : null };
  if (was.startOn !== now.startOn) out[`${base}.tools.exec`] = now.startOn === "this" ? { host: null, node: null } : { host: "node", node: now.startOn };
  return out;
}

/* ---------- Defaults for every Trunk (Technical): agents.defaults ---------- */
export const DEFAULT_KEYS = ["cwd", "workspace", "bootstrapMaxChars", "bootstrapTotalMaxChars", "userTimezone", "imageMaxDimensionPx"] as const;
export type DefaultKey = (typeof DEFAULT_KEYS)[number];
export const NUMBER_KEYS: DefaultKey[] = ["bootstrapMaxChars", "bootstrapTotalMaxChars", "imageMaxDimensionPx"];
/** The engine's own values when nothing is set (engine/src/agents/embedded-agent-helpers/bootstrap.ts, image-sanitization.ts). */
export const ENGINE_DEFAULTS: Partial<Record<DefaultKey, string>> = { bootstrapMaxChars: "20000", bootstrapTotalMaxChars: "60000", imageMaxDimensionPx: "1200" };

export function readDefaults(snap: ConfigSnapshot): Record<DefaultKey, string> {
  const d = agentDefaults(snap);
  return Object.fromEntries(DEFAULT_KEYS.map((k) => [k, d[k] === undefined || d[k] === null ? "" : String(d[k])])) as Record<DefaultKey, string>;
}
