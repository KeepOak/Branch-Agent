import { rec, rows } from "../automations/runtime";

const duration = (ms: number) => ms < 60000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60000)}m`;
/** The range is an observed min/max envelope for remaining plan steps, not all future work. */
export function paceLines(value: unknown): string[] {
  const paces = rows(value);
  if (!paces.length) return ["Pace unavailable · ETA unavailable — waiting for timed plan steps"];
  return paces.map((value, i) => {
    const p = rec(value), rate = p.stepsPerMinute;
    const prefix = paces.length > 1 ? `Run ${i + 1}: ` : "";
    const pace = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? `${rate < 0.1 ? rate.toPrecision(1) : rate.toFixed(1)} steps/min observed` : "Pace unavailable";
    const low = p.etaMinMs, high = p.etaMaxMs;
    if (typeof low === "number" && typeof high === "number" && Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low) {
      return `${prefix}${pace} · Plan ETA ${duration(low)}–${duration(high)} (observed range)`;
    }
    const reason = p.reason === "overdue" ? "current step exceeds observed range" : p.reason === "plan-complete" ? "plan complete; run still active" : p.reason === "no-plan" ? "no timed plan" : "need 3 timed step completions";
    return `${prefix}${pace} · ETA unavailable — ${reason}`;
  });
}
