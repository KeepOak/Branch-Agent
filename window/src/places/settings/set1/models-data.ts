// Shared reads for Settings › Models: the engine's model list (models.list), the connections that have accounts
// (models.authStatus) and where each choice lives in the config. Rows a Trunk can own (its model, quick-job model,
// decision model, per-model params, fast replies) follow "Settings for": agents.entries.<id>; the rest are everyone's.
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { useConfig, useScope, type Opt } from "../kit";
import type { ConfigPath } from "../config-store";
import { providersOf, type Provider } from "./accounts";
import { serviceName } from "./service";

export type Model = { ref: string; id: string; provider: string; name: string; local: boolean; available: boolean; images: boolean; thinking: Opt[]; thinkingDefault?: string };

export function modelsOf(data: RecordValue | undefined): Model[] {
  return list(data?.models).map((m) => ({
    ref: `${text(m.provider)}/${text(m.id)}`,
    id: text(m.id),
    provider: text(m.provider),
    name: visible(m.name ?? m.id),
    local: m.local === true,
    available: m.available !== false,
    images: Array.isArray(m.input) && m.input.includes("image"),
    thinking: list(m.thinkingLevels).map((t) => ({ id: text(t.id), label: visible(t.label) })),
    thinkingDefault: typeof m.thinkingDefault === "string" ? m.thinkingDefault : undefined,
  }));
}

/** The model a config value names: a "provider/model" string, or { primary }. */
export function refOf(value: unknown): string {
  if (typeof value === "string") return value;
  const primary = (value as { primary?: unknown } | undefined)?.primary;
  return typeof primary === "string" ? primary : "";
}
export function fallbacksOf(value: unknown): string[] {
  const f = (value as { fallbacks?: unknown } | undefined)?.fallbacks;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

export type Connection = { id: string; name: string; local: boolean; accounts: number; models: Model[] };

/** Every connection with a model ready: each service with accounts, then this computer. */
export function connectionsOf(models: Model[], providers: Provider[]): Connection[] {
  const out: Connection[] = [];
  for (const p of providers.filter((x) => x.profiles.length)) {
    const own = models.filter((m) => !m.local && m.provider === p.provider);
    if (own.length) out.push({ id: p.provider, name: serviceNameOf(p), local: false, accounts: p.profiles.length, models: own });
  }
  const local = models.filter((m) => m.local);
  if (local.length) out.push({ id: "local", name: "This computer", local: true, accounts: 0, models: local });
  return out;
}
function serviceNameOf(p: Provider): string {
  return serviceName(p.provider, p.displayName);
}

/** Models settings: the engine data, the config, and the path for a row a Trunk can own. */
export function useModels(engine: WindowEngine) {
  const scope = useScope();
  const agent = scope ? { agentId: scope } : {};
  const catalog = useResource<RecordValue>(engine, "models.list", { includeDetails: true, ...agent });
  const auth = useResource<RecordValue>(engine, "models.authStatus", agent);
  const cfg = useConfig(engine);
  const own = (...keys: string[]): ConfigPath => (scope ? ["agents", "entries", scope, ...keys] : ["agents", "defaults", ...keys]);
  const shared = (...keys: string[]): ConfigPath => ["agents", "defaults", ...keys];
  const models = modelsOf(catalog.data);
  const providers = providersOf(auth.data?.providers);
  /** A Trunk's own value, or the household's when it has none. */
  const ownOrShared = (...keys: string[]): unknown => cfg.get(own(...keys)) ?? (scope ? cfg.get(shared(...keys)) : undefined);
  return { engine, scope, agent, catalog, auth, cfg, own, shared, ownOrShared, models, providers, decisionModels: list(catalog.data?.decisionModels) };
}
export type ModelsCtx = ReturnType<typeof useModels>;

export const modelOpts = (models: Model[], filter: (m: Model) => boolean = () => true): Opt[] => models.filter(filter).map((m) => ({ id: m.ref, label: m.name }));
