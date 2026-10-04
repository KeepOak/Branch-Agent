// Model prices: the per-model cost the engine counts spend with (models.providers.<id>.models[].cost, in dollars per
// million tokens). Only models listed in the config can carry a price; the engine's own catalog prices stay as they are.
import type { WindowEngine } from "../../../connect/engine";
import { Ctl, Num, Sec, useConfig } from "../kit";
import { rec, str, type RecordValue } from "./common";

type Priced = { provider: string; index: number; model: RecordValue };
const FIELDS = [["input", "In"], ["output", "Out"], ["cacheRead", "Cache read"]] as const;

/** Every model the config lists, with where it sits so one price can be saved back. */
export function listedModels(cfg: RecordValue): Priced[] {
  const providers = rec(rec(cfg.models).providers);
  return Object.entries(providers).flatMap(([provider, p]) => {
    const models = rec(p).models;
    return Array.isArray(models) ? models.map((m, index) => ({ provider, index, model: rec(m) })) : [];
  });
}

/** The provider's model list with one price changed (null = take that price out). */
export function withPrice(models: unknown[], index: number, field: string, value: number | null): unknown[] {
  return models.map((m, i) => {
    if (i !== index) return m;
    const cost = { ...rec(rec(m).cost) };
    if (value === null) delete cost[field]; else cost[field] = value;
    return { ...rec(m), cost };
  });
}

export function ModelPrices({ engine }: { engine: WindowEngine }) {
  const config = useConfig(engine);
  const rows = listedModels(config.cfg);
  const save = (r: Priced, field: string, v: number | null) => {
    const models = rec(rec(rec(config.cfg.models).providers)[r.provider]).models;
    if (Array.isArray(models)) void config.set(["models", "providers", r.provider, "models"], withPrice(models, r.index, field, v));
  };
  return (
    <Sec title="Model prices" hint="What Branch counts each model at, in dollars per million tokens. Spend and the report use these.">
      {rows.length ? rows.map((r) => (
        <Ctl key={`${r.provider}/${str(r.model.id)}`} title={str(r.model.name) || str(r.model.id)} sub={`${r.provider} · ${str(r.model.id)}`}>
          {FIELDS.map(([field, label]) => (
            <Num key={field} label={`${label} price for ${str(r.model.id)}`} unit={label} value={typeof rec(r.model.cost)[field] === "number" ? Number(rec(r.model.cost)[field]) : undefined}
              disabled={config.loading} onCommit={(v) => save(r, field, v)} />
          ))}
        </Ctl>
      )) : <Ctl title="No models listed in the config" sub="Models from a service's own catalog use that service's prices." />}
    </Sec>
  );
}
