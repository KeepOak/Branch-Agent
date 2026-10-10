import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { approvals, canApprove, rec, resolveApproval, rows as listRows, str, usePlaceData } from "../places/inbox/data";
import { towerClock, towerHealth, towerNeeds, readLocked, readUsage, type TowerNeed } from "./control-tower-data";
import { isWorkingNow } from "./working-now";
import { cleanName, plainStatus } from "./plain-words";
import { syncWaitingNotices } from "./notify";
import { usagePollResult, type Limits } from "./status-data";
import "./v23-layout.css";

type Props = {
  engine: WindowEngine;
  rows: Conversation[];
  needsCount: number;
  trunkName: (id?: string) => string;
  onOpen: (key: string) => void;
  onInbox: () => void;
  onClose: () => void;
};

/** Reads only what Needs you and Working now show: usage for the health line, lockdown, and pending questions. */
function useRightNowLive(engine: WindowEngine) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [questions, setQuestions] = useState<Record<string, unknown>[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const [usage, cfg, asked] = await Promise.all([
      engine.request("usage.status", {}).catch(() => null),
      engine.request("config.get", {}).catch(() => ({})),
      engine.request("question.list", {}).catch(() => ({})),
    ]);
    setUsageFailed(usage == null);
    if (usage != null) setLimits(readUsage(usage));
    setLocked(readLocked(cfg));
    setQuestions(listRows(rec(asked).questions).filter((item) => !str(item.status) || str(item.status) === "pending"));
    setReady(true);
  }, [engine]);

  useEffect(() => {
    void load();
    const off = engine.onEvent(({ event, payload }) => {
      if (event === "config.changed" || event === "sessions.changed") void load();
      if (event === "question.requested") {
        const item = rec(payload);
        if (str(item.id) && (!str(item.status) || str(item.status) === "pending")) {
          setQuestions((current) => [...current.filter((row) => str(row.id) !== str(item.id)), item]);
        }
      }
      if (event === "question.resolved") {
        const id = str(rec(payload).id);
        if (id) setQuestions((current) => current.filter((row) => str(row.id) !== id));
      }
    });
    const onUsage = (event: Event) => {
      const polled = usagePollResult(event);
      if (polled) { setUsageFailed(false); setLimits(polled); return; }
      void load();
    };
    window.addEventListener("branch:usage-checked", onUsage);
    return () => { off(); window.removeEventListener("branch:usage-checked", onUsage); };
  }, [engine, load]);

  const dropQuestion = useCallback((id: string) => {
    if (id) setQuestions((current) => current.filter((row) => str(row.id) !== id));
  }, []);

  return { limits, usageFailed, locked, questions, dropQuestion, ready };
}

/** Placeholder rows while a read is in flight, so loading never looks like an empty result. */
function SkeletonRows({ label }: { label: string }) {
  return <div className="v23-skel" role="status" aria-label={label}>
    <span className="v23-skel-row" /><span className="v23-skel-row" />
  </div>;
}

/** The right-hand panel: what needs the person, and which Trunks are working right now. */
export function ControlTower({ engine, rows, needsCount, trunkName, onOpen, onInbox, onClose }: Props) {
  const queue = usePlaceData(engine, approvals);
  const live = useRightNowLive(engine);
  const needs = towerNeeds(rows, queue.data?.items ?? [], live.questions, trunkName);
  const working = rows.filter(isWorkingNow);
  const health = towerHealth(live.locked, false, live.limits, live.usageFailed);
  const listed = needs.slice(0, 5);
  const total = Math.max(needsCount, needs.length);
  const reading = !live.ready || (queue.loading && !queue.data);

  const decide = (item: Record<string, unknown>, decision: "allow-once" | "deny") => void queue.act(() => resolveApproval(engine, item, decision), decision === "deny" ? "Said no." : "Allowed once.");
  const answer = (need: TowerNeed, allow: boolean) => {
    const item = need.item;
    if (!item) { if (need.sessionKey) onOpen(need.sessionKey); return; }
    if (need.kind === "approval") { decide(item, allow ? "allow-once" : "deny"); return; }
    const first = rec(listRows(item.questions)[0]);
    const options = listRows(first.options);
    const simple = listRows(item.questions).length === 1 && options.length > 0 && first.multiSelect !== true && first.isSecret !== true && first.isOther !== true && !first.secretStore;
    if (allow && !simple) { if (need.sessionKey) onOpen(need.sessionKey); return; }
    void queue.act(async () => {
      const result = await engine.request("question.resolve", allow
        ? { id: str(item.id), answers: { answers: { [str(first.questionId)]: [str(options[options.length - 1]?.label)] } } }
        : { id: str(item.id), cancel: true });
      live.dropQuestion(str(item.id));
      return result;
    }, allow ? "Answered." : "Skipped. The Trunk carries on without an answer.");
  };
  useEffect(() => {
    syncWaitingNotices(needs.map((need) => ({ id: need.id, who: need.who })));
  }, [needs]);

  return <aside className="v23-tower" aria-label="Right now">
    <header><b>Right now</b><button type="button" className="ib" aria-label="Hide Right now" onClick={onClose}>×</button></header>
    {health.text ? <div className={`v23-tower-health ${health.tone}`.trim()}><i /><span>{health.text}</span></div> : null}
    <section><h3>Needs you {total ? <span>{total}</span> : null}</h3>
      {queue.error ? <p role="alert">{queue.error}</p> : null}
      {reading ? <SkeletonRows label="Reading what needs you" /> : null}
      {!reading && !needs.length && !needsCount ? <p>Nothing is waiting for you.</p> : null}
      {listed.map((need) => {
        const item = need.item ?? {};
        const request = rec(item.request);
        const decisions = Array.isArray(request.allowedDecisions) ? request.allowedDecisions : ["allow-once", "deny"];
        const expired = typeof item.expiresAtMs === "number" && item.expiresAtMs <= Date.now();
        const approval = need.kind === "approval";
        const canDecide = approval ? canApprove(engine) && !queue.busy && !expired : !queue.busy;
        return <div className="v23-tower-row" key={need.id}>
          <Face size={26} label={need.who} /><button type="button" className="v23-tower-row-text" disabled={!need.sessionKey} onClick={() => onOpen(need.sessionKey)}><b>{need.title}</b><small>{need.sub}</small></button>
          {need.kind === "waiting" ? <button type="button" className="v23-allow" onClick={() => onInbox()}>Open</button> : <>
            <button type="button" className="v23-allow" disabled={!canDecide || (approval && !decisions.includes("allow-once"))} onClick={() => answer(need, true)}>Allow</button>
            <button type="button" className="v23-deny" aria-label={`Don't allow ${need.title}`} disabled={!canDecide || (approval && !decisions.includes("deny"))} onClick={() => answer(need, false)}>×</button>
          </>}
        </div>;
      })}
      {total > listed.length ? <button type="button" className="v23-link" onClick={onInbox}>{total - listed.length} more in the Inbox</button> : null}
    </section>
    <section><h3>Working now <span>{reading ? "" : working.length}</span></h3>
      {reading ? <SkeletonRows label="Checking what is working" /> : null}
      {!reading && working.length ? working.map((row) => <button type="button" className="v23-tower-row" key={row.key} onClick={() => onOpen(row.key)}><Face size={26} label={trunkName(row.agentId)} /><span className="v23-tower-row-text"><b>{cleanName(row.title) || trunkName(row.agentId)}</b><small>{plainStatus(row.headline || row.preview || "", row.key) || "Working"}</small></span><time className="v23-tower-time">{towerClock(row.updatedAt)}</time></button>)
        : null}
      {!reading && !working.length ? <p>No Trunk is working right now.</p> : null}
    </section>
  </aside>;
}
