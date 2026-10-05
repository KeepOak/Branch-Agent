// Which OpenAI models the signed-in ChatGPT plan can run. codex.models {agentId} answers with the Codex app-server's
// model list for that account (engine extensions/codex/src/app-server/models.ts); a Codex-run OpenAI model missing
// from it is shown greyed and can't be picked, as upstream's model select keeps unavailable rows disabled and last
// (engine/ui/src/lib/chat/model-select-state.ts). An error (older engine, no ChatGPT account) or an empty list
// changes nothing.
import { useEffect, useState } from "react";
import { list, rec, str, type WindowEngine } from "./engine";
import type { ModelChoice } from "./model";

export const NOT_ON_PLAN = "Not on your ChatGPT plan";
const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; plan: Set<string> | null }>();

const bare = (id: string) => id.trim().toLowerCase().replace(/^openai\//, "");

/** The model ids on the plan (each row's id and model; hidden rows still run), or null when the list is empty. */
export function planModelIds(result: unknown): Set<string> | null {
  const ids = new Set<string>();
  for (const r of list(rec(result).models)) {
    for (const v of [str(r.id), str(r.model)]) if (v.trim()) ids.add(bare(v));
  }
  return ids.size ? ids : null;
}

export const runsOnCodex = (m: ModelChoice) => m.provider === "openai" && m.runtimeMetadata?.agentRuntime?.id === "codex";

/** True when the plan's list is known and this Codex-run OpenAI model is not on it. */
export function offPlan(m: ModelChoice, plan: Set<string> | null): boolean {
  return plan !== null && runsOnCodex(m) && !plan.has(bare(m.id));
}

/** Each group's models with the ones off the plan moved last, in their order. */
export function planOrder(models: ModelChoice[], plan: Set<string> | null): ModelChoice[] {
  return plan ? [...models.filter((m) => !offPlan(m, plan)), ...models.filter((m) => offPlan(m, plan))] : models;
}

/** codex.models once per picker open, kept a minute so reopening the picker doesn't ask again. */
export function useCodexPlan(engine: WindowEngine | undefined, agentId: string | undefined, wanted: boolean): Set<string> | null {
  const [plan, setPlan] = useState<Set<string> | null>(() => (agentId ? cache.get(agentId)?.plan ?? null : null));
  useEffect(() => {
    if (!engine || !agentId || !wanted) return;
    const hit = cache.get(agentId);
    if (hit && Date.now() - hit.at < FRESH_MS) {
      setPlan(hit.plan);
      return;
    }
    let live = true;
    const keep = (value: Set<string> | null) => {
      cache.set(agentId, { at: Date.now(), plan: value });
      if (live) setPlan(value);
    };
    engine.request("codex.models", { agentId }).then((r) => keep(planModelIds(r)), () => keep(null));
    return () => {
      live = false;
    };
  }, [engine, agentId, wanted]);
  return plan;
}

/** Test seam: forget what codex.models answered. */
export function forgetCodexPlans(): void {
  cache.clear();
}
