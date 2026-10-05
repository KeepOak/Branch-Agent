// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../connect/engine";

export type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
export function list(value: unknown): RecordValue[] { return Array.isArray(value) ? value.map(record) : []; }
export function at(value: unknown, path: string): unknown { return path.split(".").reduce<unknown>((v, key) => record(v)[key], value); }
export function text(value: unknown): string { return value === undefined || value === null ? "Not set" : typeof value === "object" ? JSON.stringify(value) : String(value); }
export function errorText(error: unknown): string { return error instanceof Error ? error.message : text(error); }

export type ConfigSnapshot = { hash?: string; valid?: boolean; config?: RecordValue; issues?: unknown; writeError?: unknown };
export async function saveConfig(engine: WindowEngine, snapshot: ConfigSnapshot, changes: Record<string, unknown>): Promise<ConfigSnapshot> {
  if (!snapshot.hash) throw new Error("The engine did not provide a configuration revision. Reload before saving.");
  if (snapshot.valid === false) throw new Error("The engine configuration is invalid. Resolve its validation errors before saving.");
  const patch: RecordValue = {};
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split("."); let target = patch;
    for (const key of keys.slice(0, -1)) { target[key] ??= {}; target = record(target[key]); }
    target[keys[keys.length - 1]] = value;
  }
  const result = record(await engine.request("config.patch", { raw: JSON.stringify(patch), baseHash: snapshot.hash }));
  if (result.ok === false) throw new Error(text(result.error ?? "The engine did not save the configuration."));
  return engine.request<ConfigSnapshot>("config.get", {});
}
export type AgentFile = { name: string; content?: string; hash?: string; missing?: boolean };
export async function saveAgentFile(engine: WindowEngine, agentId: string, file: AgentFile, content: string): Promise<AgentFile> {
  if (!file.missing && !file.hash) throw new Error("The engine did not provide a file revision. Reload before saving.");
  const result = record(await engine.request("agents.files.set", {
    agentId, name: file.name, content, ...(file.missing ? { expectedMissing: true } : { expectedHash: file.hash }),
  }));
  if (result.ok === false) throw new Error(text(result.error ?? "The document could not be saved."));
  const refreshed = await engine.request<{ file: AgentFile }>("agents.files.get", { agentId, name: file.name });
  return refreshed.file;
}

/** Keep technical keys compatible; rename only human-facing values. Never render secret material. */
export function visible(value: unknown): string {
  return text(value).replace(/OpenClaw/gi, "Branch Agent").replace(/Crabbox/gi, "Cuttings").replace(/ClawHub/gi, "Seedbank").replace(/Peekaboo/gi, "Knothole").replace(/Lobsterdex/gi, "Trellis index").replace(/Lobster/gi, "Trellis").replace(/ClawRouter/gi, "Rootway").replace(/ClawSweeper/gi, "Rake").replace(/clawpack/gi, "Seedpod").replace(/Molty/gi, "Sprig").replace(/Workboard/gi, "Canopy").replace(/Dreaming/gi, "Rings");
}
export function safeEntries(value: unknown): [string, unknown][] {
  return Object.entries(record(value)).filter(([key, item]) => !/secret|password|credential|api.?key|raw|content/i.test(key) && !(/token/i.test(key) && !(typeof item === "number" && /(?:Tokens|TokenCount|TokensUsed|TokensRemaining|TokenLimit)$/i.test(key))));
}
