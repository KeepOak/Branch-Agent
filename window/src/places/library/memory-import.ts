// Shared memory import: migrations.memory.plan / apply. Settings › Data & usage › Moving in and out and Library › Memory › Bring in
// both call these helpers so there is one importer, not two.
import type { WindowEngine } from "../../connect/engine";
import { errorText, rec, str } from "./data";

const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const count = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export type Found = { providerId: string; label: string; fingerprint: string; items: string[] };

export type PlannedItem = { id: string; status: string; source: string; target: string; message: string };

export type ProviderPlan = {
  providerId: string;
  label: string;
  found: boolean;
  fingerprint: string;
  message: string;
  items: PlannedItem[];
  plannedIds: string[];
  warnings: string[];
  planned: number;
  skipped: number;
  conflicts: number;
  errors: number;
};

export type ApplySummary = { migrated: number; skipped: number; conflicts: number; errors: number };

/** Greyed reason when the session is not the owner (operator.admin). Shown; not a developer note. */
export const BRING_IN_WRITE_REASON = "Needs an owner";

/** migrations.memory.plan: every assistant the engine reported, found or not. */
export function readProviders(result: unknown): ProviderPlan[] {
  return list(rec(result).providers)
    .map((p) => {
      const items = list(p.items).map((i) => ({
        id: str(i.id),
        status: str(i.status),
        source: str(i.source),
        target: str(i.target),
        message: str(i.message) || str(i.reason),
      }));
      const plannedIds = items.filter((i) => i.status === "planned").map((i) => i.id);
      const summary = rec(p.summary);
      return {
        providerId: str(p.providerId),
        label: str(p.label) || str(p.providerId),
        found: p.found === true,
        fingerprint: str(p.planFingerprint),
        message: str(p.message) || str(p.error),
        items,
        plannedIds,
        warnings: Array.isArray(p.warnings) ? p.warnings.filter((w): w is string => typeof w === "string") : [],
        planned: count(summary.planned, plannedIds.length),
        skipped: count(summary.skipped),
        conflicts: count(summary.conflicts),
        errors: count(summary.errors),
      };
    })
    .filter((p) => p.providerId);
}

/** migrations.memory.plan: each assistant found on this computer with the items it would bring in. */
export function readFound(result: unknown): Found[] {
  return readProviders(result)
    .filter((p) => p.found && p.plannedIds.length > 0)
    .map((p) => ({ providerId: p.providerId, label: p.label, fingerprint: p.fingerprint, items: p.plannedIds }));
}

export function readApplySummary(result: unknown): ApplySummary {
  const s = rec(rec(result).summary);
  return { migrated: count(s.migrated), skipped: count(s.skipped), conflicts: count(s.conflicts), errors: count(s.errors) };
}

function applyParams(agentId: string, providerId: string, fingerprint: string, itemIds: string[]) {
  return { idempotencyKey: crypto.randomUUID(), agentId, providerId, planFingerprint: fingerprint, itemIds };
}

/** migrations.memory.apply for one planned assistant. Throws on an engine refusal so nothing is treated as half-done. */
export async function applyMemoryImport(
  engine: WindowEngine,
  agentId: string,
  provider: { providerId: string; fingerprint: string; items: string[] },
): Promise<unknown> {
  const result = await engine.request("migrations.memory.apply", applyParams(agentId, provider.providerId, provider.fingerprint, provider.items));
  if (result !== null && typeof result === "object" && "ok" in result && (result as { ok?: unknown }).ok === false) {
    const response = result as { error?: unknown; message?: unknown };
    throw new Error(errorText(response.error ?? response.message ?? "The engine did not apply this change."));
  }
  return result;
}

export function whatComesIn(p: ProviderPlan): string {
  const bits = [
    p.found ? "Found on this computer" : (p.message || "Not found here"),
    p.found && p.planned ? `${p.planned} ready to bring in` : "",
    p.found && p.skipped ? `${p.skipped} skipped` : "",
    p.found && p.conflicts ? `${p.conflicts} ${p.conflicts === 1 ? "clash" : "clashes"}` : "",
    p.found && p.warnings.length ? p.warnings.join(" · ") : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export function summaryLine(s: ApplySummary): string {
  return `${s.migrated} brought in · ${s.skipped} skipped · ${s.conflicts} clashes${s.errors ? ` · ${s.errors} failed` : ""}`;
}
