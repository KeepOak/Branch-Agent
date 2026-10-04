import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import "./activity-strip.css";

type Allowance = { provider: string; label: string; used: number; resetAt?: number };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};

/** Only service-measured finite values are allowances; missing figures are not zero usage. */
export function readAllowances(value: unknown): Allowance[] {
  const providers = record(value).providers;
  if (!Array.isArray(providers)) return [];
  return providers.flatMap(raw => {
    const p = record(raw);
    if (p.error || !Array.isArray(p.windows)) return [];
    const provider = typeof p.displayName === "string" ? p.displayName : String(p.provider ?? "Model account");
    return p.windows.flatMap(rawWindow => {
      const w = record(rawWindow);
      if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return [];
      return [{ provider, label: typeof w.label === "string" ? w.label : "Allowance", used: Math.min(100, Math.max(0, w.usedPercent)),
        ...(typeof w.resetAt === "number" && Number.isFinite(w.resetAt) ? { resetAt: w.resetAt } : {}) }];
    });
  });
}

export function UsageBar({ engine }: { engine?: WindowEngine }) {
  const [result, setResult] = useState<{ engine?: WindowEngine; rows: Allowance[]; error: boolean }>({ rows: [], error: false });
  const state = result.engine === engine ? { ...result, loading: false } : { rows: [], loading: true, error: false };
  useEffect(() => {
    if (!engine) return;
    let live = true, revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const data = await engine.request("usage.status", {});
        if (live && current === revision) setResult({ engine, rows: readAllowances(data), error: false });
      } catch {
        if (live && current === revision) setResult({ engine, rows: [], error: true });
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [engine]);
  if (!engine) return null;
  return <section className="conversation-usage" aria-label="Model account usage">
    <span className="usage-heading">Usage</span>
    {state.rows.length ? <div className="usage-windows">{state.rows.map((row, i) => <div className="usage-window" key={`${row.provider}-${row.label}-${i}`}>
      <span>{row.provider} · {row.label}</span>
      <meter min={0} max={100} value={row.used} aria-label={`${row.provider} ${row.label} usage`} />
      <b>{Math.round(row.used)}% used</b>
      {row.resetAt ? <small>Resets {new Date(row.resetAt).toLocaleString()}</small> : null}
    </div>)}</div> : <span className="usage-unavailable">{state.loading ? "Checking allowances…" : state.error ? "Usage unavailable" : "No measured allowance reported"}</span>}
  </section>;
}
