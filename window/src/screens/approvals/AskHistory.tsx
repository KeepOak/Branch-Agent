// What was answered and what stays allowed (HANDOFF R1-05 engine calls): the answered list from approval.history
// (newest first, paged by cursor) and the standing "Always allow" grants from exec.approval.grants.list, each with
// Take back (exec.approval.grants.revoke). Settings › Permissions mounts it.
import { useCallback, useEffect, useState } from "react";
import { availability, requestOrComing } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type HistoryRow = { id: string; what: string; outcome: string; tone: "ok" | "bad" | "idle"; at: number };
export type GrantRow = { grantId: string; command: string; job: string; uses: number };

/** One approval.history item as a row: what it was, and how it ended. */
export function historyRow(item: unknown): HistoryRow | null {
  const r = rec(item), pres = rec(r.presentation), id = str(r.id);
  if (!id) return null;
  const what = str(pres.title) || str(pres.commandText) || "An approval";
  const outcome = r.status === "allowed" ? (r.decision === "allow-always" ? "✓ Always allowed" : "✓ Allowed")
    : r.status === "denied" ? "✕ Declined" : r.status === "expired" ? "Expired · not allowed" : "Cancelled";
  return { id, what, outcome, tone: r.status === "allowed" ? "ok" : r.status === "denied" ? "bad" : "idle", at: typeof r.resolvedAtMs === "number" ? r.resolvedAtMs : 0 };
}

export function grantRow(item: unknown): GrantRow | null {
  const r = rec(item);
  if (!str(r.grantId) || r.revokedAtMs) return null;
  return { grantId: str(r.grantId), command: str(r.command), job: str(r.cronJobName) || str(r.cronJobId), uses: typeof r.useCount === "number" ? r.useCount : 0 };
}

export function AskHistory({ engine, limit = 20 }: { engine: WindowEngine | null; limit?: number }) {
  const [rows, setRows] = useState<HistoryRow[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]), [error, setError] = useState<string | null>(null), [loaded, setLoaded] = useState(false);
  const page = useCallback(async (from?: string) => {
    if (!engine || availability(engine, "approval.history") === "no") return;
    try {
      const result = rec(await requestOrComing(engine, "approval.history", { limit, ...(from ? { cursor: from } : {}) }));
      const next = (Array.isArray(result.items) ? result.items : []).map(historyRow).filter((x): x is HistoryRow => Boolean(x));
      setRows((old) => (from ? [...old, ...next.filter((row) => !old.some((o) => o.id === row.id))] : next));
      setCursor(str(result.nextCursor) || null);
      setError(null);
    } catch (e) { setError(errorText(e)); } finally { setLoaded(true); }
  }, [engine, limit]);
  const loadGrants = useCallback(async () => {
    if (!engine || availability(engine, "exec.approval.grants.list") === "no") return;
    try {
      const result = rec(await requestOrComing(engine, "exec.approval.grants.list", {}));
      setGrants((Array.isArray(result.grants) ? result.grants : []).map(grantRow).filter((x): x is GrantRow => Boolean(x)));
    } catch (e) { setError(errorText(e)); }
  }, [engine]);
  useEffect(() => { void page(); void loadGrants(); }, [page, loadGrants]);
  const revoke = async (grantId: string) => {
    if (!engine) return;
    try { await requestOrComing(engine, "exec.approval.grants.revoke", { grantId }); await loadGrants(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <section className="r1-ask-history" aria-label="Approvals" data-testid="r1-ask-history">
      <h3>Always allowed</h3>
      {grants.length ? grants.map((g) => (
        <div className="r1-ask-row" key={g.grantId}>
          <code>{g.command}</code><small>{g.job}{g.uses ? `· used ${g.uses}×` : ""}</small>
          <Coming need="exec.approval.grants.revoke" reason="Taking back an Always allow comes in a later update."><button type="button" className="r1-ask-btn" data-kind="ghost" onClick={() => void revoke(g.grantId)}>Take back</button></Coming>
        </div>
      )) : <p className="r1-ask-note">Nothing is always allowed.</p>}
      <h3>Answered</h3>
      {rows.map((r) => (
        <div className="r1-ask-row" key={r.id}><span className="r1-ask-pill" data-tone={r.tone}>{r.outcome}</span><span>{r.what}</span>{r.at ? <time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleString()}</time> : null}</div>
      ))}
      {loaded && !rows.length && !error ? <p className="r1-ask-note">Nothing answered yet.</p> : null}
      {error ? <p className="r1-ask-error" role="alert">{error}</p> : null}
      {cursor ? <Coming need="approval.history"><button type="button" className="r1-ask-btn" data-kind="ghost" onClick={() => void page(cursor)}>Show more</button></Coming> : null}
    </section>
  );
}
