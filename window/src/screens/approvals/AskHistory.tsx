// The Approvals record (preview apprDlgPS18, opened from Settings › Permissions' Approvals row): Waiting now, the
// standing permissions automations hold, and what was answered, newest first. The waiting list comes from the caller's
// useAsks; the grants and the answered list come from exec.approval.grants.list and approval.history.
import { useCallback, useEffect, useState } from "react";
import { availability, requestOrComing } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { LOCKDOWN_WHY } from "./AskCard";
import { RESOLVE_OF, type Reply } from "./model";
import type { AskState } from "./useAsks";
import { groupable } from "./AskGroup";

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

type Props = {
  engine: WindowEngine | null;
  limit?: number;
  /** What waits for a yes now (approvals/useAsks), drawn as Waiting now; questions are answered in their conversation. */
  waiting?: readonly AskState[];
  /** Answers a waiting row through its own call (useAsks answer). */
  onAnswer?: (id: string, reply: Reply) => void;
  lockdown?: boolean;
};

/** Waiting now: Don't, Allow, and Always allow where the request offers it (preview apprDlgPS18). */
function WaitingRows({ waiting, onAnswer, lockdown }: { waiting: readonly AskState[]; onAnswer: (id: string, reply: Reply) => void; lockdown?: boolean }) {
  const rows = waiting.filter(groupable);
  if (!rows.length) return <p className="r1-ask-note">Nothing is waiting.</p>;
  return <>{rows.map(({ ask, status }) => {
    const busy = status === "sending";
    return (
      <div className="r1-ask-row" key={ask.id} data-approval={ask.id}>
        <span>{ask.title.replace(/\?$/, "")}{ask.code ? <code>{ask.code}</code> : null}</span><small>{ask.agentId || "Your Trunk"}</small>
        <Coming need={RESOLVE_OF[ask.kind]} reason="Answering here comes in a later update."><button type="button" className="r1-ask-btn" data-kind="ghost" disabled={busy} onClick={() => onAnswer(ask.id, "deny")}>Don’t</button></Coming>
        <Coming need={RESOLVE_OF[ask.kind]} reason="Answering here comes in a later update."><button type="button" className="r1-ask-btn" disabled={busy || lockdown} title={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => onAnswer(ask.id, "allow-once")}>Allow</button></Coming>
        {ask.allowed.includes("allow-always") ? <Coming need={RESOLVE_OF[ask.kind]} reason="Answering here comes in a later update."><button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" disabled={busy || lockdown} title={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => onAnswer(ask.id, "allow-always")}>Always allow</button></Coming> : null}
      </div>
    );
  })}</>;
}

export function AskHistory({ engine, limit = 20, waiting, onAnswer, lockdown }: Props) {
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
    <section className="r1-ask-history g-clear" aria-label="Approvals" data-testid="r1-ask-history">
      {waiting && onAnswer ? <>
        <h3>Waiting now</h3>
        <WaitingRows waiting={waiting} onAnswer={onAnswer} lockdown={lockdown} />
      </> : null}
      <h3>Standing permissions</h3>
      <p className="r1-ask-note">Always allow on an automation’s request makes a standing permission for that exact command. Revoke it and the next run asks again. Editing or deleting the automation ends its permissions.</p>
      {grants.length ? grants.map((g) => (
        <div className="r1-ask-row" key={g.grantId}>
          <span>{g.job || g.command}</span><small><code>{g.command}</code> · {g.uses} uses · Until you revoke it</small>
          <Coming need="exec.approval.grants.revoke" reason="Taking back an Always allow comes in a later update."><button type="button" className="r1-ask-btn" data-kind="ghost" onClick={() => void revoke(g.grantId)}>Revoke</button></Coming>
        </div>
      )) : <p className="r1-ask-note">No standing permissions. Answer an automation’s request with Always allow to make one.</p>}
      <h3>Answered</h3>
      {rows.map((r) => (
        <div className="r1-ask-row" key={r.id}><span className="r1-ask-pill" data-tone={r.tone}>{r.outcome}</span><span>{r.what}</span>{r.at ? <time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleString()}</time> : null}</div>
      ))}
      {loaded && !rows.length && !error ? <p className="r1-ask-note">No answered approvals in the last 30 days.</p> : null}
      {rows.length ? <p className="r1-ask-note">Answers are kept for 30 days.</p> : null}
      {error ? <p className="r1-ask-error" role="alert">{error}</p> : null}
      {cursor ? <Coming need="approval.history"><button type="button" className="r1-ask-btn" data-kind="ghost" onClick={() => void page(cursor)}>Load more</button></Coming> : null}
    </section>
  );
}
