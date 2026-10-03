import { useEffect, useState } from "react";
import "./plan.css";
import type { WindowEngine } from "../connect/engine";
// Mirrors engine/packages/gateway-protocol/src/schema/progress-card.ts. The
// generated protocol declaration currently loses its TypeBox namespace types.
export type ProgressCard = {
  sessionKey: string;
  revision: number;
  updatedAt: number;
  markdown?: string;
  steps?: { step: string; status: "pending" | "in_progress" | "completed" }[];
};
export function readProgressCard(value: unknown, sessionKey: string | null): ProgressCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  if (
    card.sessionKey !== sessionKey ||
    typeof card.sessionKey !== "string" ||
    !card.sessionKey ||
    !Number.isInteger(card.revision) ||
    Number(card.revision) < 1 ||
    typeof card.updatedAt !== "number" ||
    !Number.isFinite(card.updatedAt)
  )
    return null;
  if (card.markdown !== undefined && typeof card.markdown !== "string") return null;
  if (
    card.steps !== undefined &&
    (!Array.isArray(card.steps) ||
      card.steps.some(
        (step) =>
          !step ||
          typeof step !== "object" ||
          typeof step.step !== "string" ||
          !step.step.trim() ||
          !["pending", "in_progress", "completed"].includes(step.status),
      ))
  )
    return null;
  return card as ProgressCard;
}
/** Read-only card data is scoped to the engine handle (connection and conversation). */
export function useProgressCard(engine: WindowEngine) {
  const [state, setState] = useState<{
    owner: WindowEngine;
    card: ProgressCard | null;
    error: string;
  }>({ owner: engine, card: null, error: "" });
  useEffect(() => {
    let active = true,
      revision = 0;
    const load = async () => {
      const operation = ++revision;
      try {
        const result = await engine.request<{ card: unknown }>("progressCard.get", {
          sessionKey: engine.sessionKey,
        });
        if (active && operation === revision)
          setState({
            owner: engine,
            card: readProgressCard(result.card, engine.sessionKey),
            error: "",
          });
      } catch (e) {
        if (active && operation === revision)
          setState({
            owner: engine,
            card: null,
            error: e instanceof Error ? e.message : String(e),
          });
      }
    };
    if (engine.sessionKey) void load();
    const unsub = engine.onEvent((e) => {
      const p = e.payload as { sessionKey?: string } | undefined;
      if (e.event === "progressCard.changed" && p?.sessionKey === engine.sessionKey) void load();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [engine]);
  return state.owner === engine ? state : { owner: engine, card: null, error: "" };
}
type RefreshState = "asking" | "updated" | "none" | "fail" | null;
const REFRESH_WORDS: Record<Exclude<RefreshState, null>, string> = {
  asking: "Asking for an update…",
  updated: "Updated",
  none: "No new update yet.",
  fail: "Couldn’t refresh. The last update is kept.",
};

/** Refresh (§4.2.2 Plan card): progressCard.refresh starts a run that updates the card; "Updated" once a newer
 *  revision arrives, "No new update yet." if that run ends without one. */
export function usePlanRefresh(engine: WindowEngine, card: ProgressCard | null) {
  const [state, setState] = useState<{ run: string; from: number; status: RefreshState } | null>(null);
  const revision = card?.revision ?? 0;
  useEffect(() => {
    if (state?.status === "asking" && revision > state.from) setState({ ...state, status: "updated" });
  }, [revision, state]);
  useEffect(() => {
    if (state?.status !== "asking" || !state.run) return;
    return engine.onEvent((e) => {
      const p = e.payload as { runId?: string; state?: string } | undefined;
      if (e.event === "chat" && p?.runId === state.run && (p.state === "final" || p.state === "error" || p.state === "aborted")) {
        setState((s) => (s && s.status === "asking" ? { ...s, status: "none" } : s));
      }
    });
  }, [engine, state]);
  useEffect(() => setState(null), [engine]);
  const refresh = () => {
    if (!engine.sessionKey) return;
    setState({ run: "", from: revision, status: "asking" });
    engine
      .request<{ runId?: string }>("progressCard.refresh", { sessionKey: engine.sessionKey, ...(engine.agentId ? { agentId: engine.agentId } : {}), idempotencyKey: crypto.randomUUID() })
      .then((r) => setState((s) => (s && s.status === "asking" ? { ...s, run: String(r?.runId ?? "") } : s)), () => setState({ run: "", from: revision, status: "fail" }));
  };
  return { status: state?.status ?? null, refresh };
}

const DISMISSED = "branch.planDismissed";
/** Dismiss hides this revision of the card; a newer revision shows again. Kept on this computer. */
export function usePlanDismiss(card: ProgressCard | null) {
  const id = card ? `${card.sessionKey}#${card.revision}` : "";
  const [gone, setGone] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(DISMISSED) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const dismiss = () => {
    const next = [...gone.filter((g) => !g.startsWith(`${card?.sessionKey}#`)), id];
    setGone(next);
    try {
      localStorage.setItem(DISMISSED, JSON.stringify(next.slice(-200)));
    } catch {
      // storage blocked: dismissed for this window only
    }
  };
  return { dismissed: Boolean(id) && gone.includes(id), dismiss };
}

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const ICON = { retry: "M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5", x: "M6 6l12 12M18 6L6 18" };
const small = (d: string) => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/** The Plan card (§4.2.2): "Plan", "<n> of <m> done", the steps as boxes, the progress note; Refresh and Dismiss
 *  while it is going, a Done pill and its time once every step is done. */
export function PlanCard({ card, onRefresh, onDismiss, refreshing }: { card: ProgressCard; onRefresh?: () => void; onDismiss?: () => void; refreshing?: RefreshState }) {
  const steps = card.steps || [];
  const done = steps.filter((s) => s.status === "completed").length;
  const finished = steps.length > 0 && done === steps.length;
  return (
    <section className="card plan-card indent" aria-label="Plan" data-testid="plan-card">
      <header className="plan-h">
        <b>Plan</b>
        <span className="plan-n">{done} of {steps.length} done</span>
        {finished ? (
          <>
            <span className="pill ok plan-end"><i />Done</span>
            <span className="plan-n">{new Date(card.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </>
        ) : (
          <>
            <span className="plan-sp" />
            {onRefresh ? <button type="button" className="ib plan-ib" aria-label="Refresh" title="Refresh" disabled={refreshing === "asking"} onClick={onRefresh}>{small(ICON.retry)}</button> : null}
            {onDismiss ? <button type="button" className="ib plan-ib" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>{small(ICON.x)}</button> : null}
          </>
        )}
      </header>
      <ul className="plan">
        {steps.map((s, i) => (
          <li key={i} className={s.status === "completed" ? "done" : s.status === "in_progress" ? "now" : ""} data-state={s.status}>
            <span className="box">{s.status === "completed" ? CHECK : null}</span>
            <span>{s.step}</span>
          </li>
        ))}
      </ul>
      {card.markdown ? (
        <p className="plan-note">
          <span>Progress note</span>
          {card.markdown}
        </p>
      ) : null}
      {refreshing ? <p className="plan-r" role="status">{REFRESH_WORDS[refreshing]}</p> : null}
    </section>
  );
}

/** Where the plan card goes: after the turn whose steps last updated it (the progress_card tool), or at the end. */
export function planAnchor(history: readonly { kind: string; tool?: string }[]): number {
  let at = -1;
  history.forEach((b, i) => {
    if (b.kind === "step" && b.tool === "progress_card") at = i;
  });
  if (at < 0) return -1;
  while (at + 1 < history.length && history[at + 1].kind !== "user") at += 1;
  return at === history.length - 1 ? -1 : at;
}
