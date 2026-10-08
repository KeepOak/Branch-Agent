import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { approvals, canApprove, rec, resolveApproval, rows as listRows, str, usePlaceData } from "../places/inbox/data";
import { Menu, type MenuAnchor, type MenuItem } from "./Menu";
import {
  checkedLine,
  jobProgress,
  justEndedKeys,
  openTowerPlace,
  openTowerSettings,
  readCronJobs,
  readLocked,
  readUsage,
  towerAccounts,
  towerChatter,
  towerClock,
  towerComingUp,
  towerFinished,
  towerHealth,
  towerNeeds,
  trunkList,
  type TowerNeed,
} from "./control-tower-data";
import { syncWaitingNotices } from "./notify";
import { usagePollResult, type Limits } from "./status-data";
import { whoItKnowsItems } from "./who-it-knows-menu";
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

function useTowerLive(engine: WindowEngine, rows: Conversation[]) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [jobs, setJobs] = useState<unknown[]>([]);
  const [audit, setAudit] = useState<unknown>({});
  const [endedKeys, setEndedKeys] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [usageFailed, setUsageFailed] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Record<string, unknown>[]>([]);
  const [trunks, setTrunks] = useState<{ defaultId: string; list: { id: string; name: string }[]; ready: boolean }>({ defaultId: "", list: [], ready: false });
  const workingKeys = useRef<string[]>([]);

  const rememberEnded = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setEndedKeys((prev) => [...keys, ...prev.filter((key) => !keys.includes(key))].slice(0, 4));
  }, []);

  const load = useCallback(async () => {
    const [usage, cron, cfg, activity, listed, asked] = await Promise.all([
      engine.request("usage.status", {}).catch(() => null),
      engine.request("cron.list", { limit: 200 }).catch(() => ({})),
      engine.request("config.get", {}).catch(() => ({})),
      engine.request("audit.activity.list", { kind: "agent_run", limit: 200 }).catch(() =>
        engine.request("audit.list", { kind: "agent_run", limit: 200 }).catch(() => ({}))),
      engine.request("agents.list", {}).catch(() => ({})),
      engine.request("question.list", {}).catch(() => ({})),
    ]);
    if (usage == null) setUsageFailed(true);
    else {
      setUsageFailed(false);
      setLimits(readUsage(usage));
    }
    setJobs(readCronJobs(cron));
    setLocked(readLocked(cfg));
    setAudit(activity);
    setTrunks({ ...trunkList(listed), ready: true });
    setQuestions(listRows(rec(asked).questions).filter((item) => !str(item.status) || str(item.status) === "pending"));
  }, [engine]);

  useEffect(() => {
    const ended = justEndedKeys(workingKeys.current, rows);
    workingKeys.current = rows.filter((row) => row.working && !row.archived && !row.helper && !row.system).map((row) => row.key);
    rememberEnded(ended);
  }, [rows, rememberEnded]);

  useEffect(() => {
    void load();
    const off = engine.onEvent(({ event, payload }) => {
      if (event === "cron" || event === "config.changed" || event === "sessions.changed" || event === "rooms.changed") void load();
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
      if (event === "chat") {
        const body = rec(payload);
        if (["final", "error", "aborted"].includes(str(body.state))) {
          const key = str(body.sessionKey);
          if (key) rememberEnded([key]);
          void load();
        }
      }
    });
    const onUsage = (event: Event) => {
      const polled = usagePollResult(event);
      if (polled) {
        setUsageFailed(false);
        setLimits(polled);
        setCheckError(null);
        return;
      }
      void load();
    };
    window.addEventListener("branch:usage-checked", onUsage);
    return () => { off(); window.removeEventListener("branch:usage-checked", onUsage); };
  }, [engine, load, rememberEnded]);

  const checkNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      await engine.request("models.authStatus", { refresh: true }).catch(() => undefined);
      const result = await engine.request("usage.status", { refresh: true });
      const next = readUsage(result);
      setUsageFailed(false);
      setLimits(next);
      window.dispatchEvent(new CustomEvent("branch:usage-checked", { detail: next }));
    } catch {
      setUsageFailed(true);
      setCheckError("Couldn’t check accounts right now. Branch will try again.");
    } finally {
      setChecking(false);
    }
  }, [checking, engine]);

  const dropQuestion = useCallback((id: string) => {
    if (!id) return;
    setQuestions((current) => current.filter((row) => str(row.id) !== id));
  }, []);

  return { limits, jobs, audit, endedKeys, locked, checking, usageFailed, checkError, trunks, questions, dropQuestion, checkNow };
}

/** Live Control tower. The preview's sample approvals and jobs are never shown as real data. */
export function ControlTower({ engine, rows, needsCount, trunkName, onOpen, onInbox, onClose }: Props) {
  const queue = usePlaceData(engine, approvals);
  const live = useTowerLive(engine, rows);
  const pending = queue.data?.items ?? [];
  const needs = towerNeeds(rows, pending, live.questions, trunkName);
  const working = rows.filter((row) => row.working && !row.archived && !row.helper && !row.system);
  const jobs = rows.filter((row) => row.working && !row.archived && row.helper && !row.system);
  const chatter = towerChatter(rows);
  const finished = towerFinished(rows, live.audit, Date.now(), live.endedKeys);
  const coming = towerComingUp(live.jobs);
  const accounts = towerAccounts(live.limits);
  const health = towerHealth(live.locked, live.checking, live.limits, live.usageFailed);
  const listed = needs.slice(0, 5);
  const total = Math.max(needsCount, needs.length);
  const [known, setKnown] = useState<{ at: MenuAnchor; items: MenuItem[] } | null>(null);
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
  const knownWhy = !live.trunks.ready ? "Still loading Trunks." : !live.trunks.list.length ? "No Trunks yet." : undefined;
  const openKnown = async (event: MouseEvent<HTMLButtonElement>) => {
    if (knownWhy) return;
    const box = event.currentTarget.getBoundingClientRect();
    const self = live.trunks.list.find((row) => row.id === live.trunks.defaultId) ?? live.trunks.list[0];
    if (!self) return;
    const items = await whoItKnowsItems((method, params) => engine.request(method, params), self, live.trunks.list);
    setKnown({ at: { x: box.left, y: box.bottom + 4 }, items });
  };
  return <aside className="v23-tower" aria-label="Control tower">
    <header><b>Control tower</b><button type="button" className="ib" aria-label="Hide the control tower" onClick={onClose}>×</button></header>
    <div className={`v23-tower-health ${health.tone}`.trim()}><i /><span>{health.text}</span></div>
    <section><h3>Needs you {total ? <span>{total}</span> : null}</h3>
      {queue.error ? <p role="alert">{queue.error}</p> : null}
      {!needs.length && !needsCount ? <p>Nothing is waiting for you.</p> : null}
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
    <section><h3>Working now <span>{working.length + jobs.length}</span></h3>
      {working.length || jobs.length ? <>
        {working.map((row) => <button type="button" className="v23-tower-row" key={row.key} onClick={() => onOpen(row.key)}><Face size={26} label={trunkName(row.agentId)} /><span className="v23-tower-row-text"><b>{row.title || trunkName(row.agentId)}</b><small>{row.headline || row.preview || "Working"}</small></span><time className="v23-tower-time">{towerClock(row.updatedAt)}</time></button>)}
        {jobs.map((row) => {
          const progress = jobProgress(row.headline, row.preview);
          return <button type="button" className="v23-tower-row" key={row.key} onClick={() => onOpen(row.key)}><Face size={26} label={trunkName(row.agentId)} /><span className="v23-tower-row-text"><b>{row.title || trunkName(row.agentId)}</b><small>{trunkName(row.agentId)}{progress !== null ? ` · ${progress}%` : ""}</small></span>{progress !== null ? <span className="v23-tower-bar" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span> : null}</button>;
        })}
      </> : <p>No Trunk is working right now.</p>}
    </section>
    <section><h3>Team chatter <button type="button" className="v23-link" title={knownWhy ?? "Who each Trunk may message"} disabled={Boolean(knownWhy)} onClick={(event) => void openKnown(event)}>Who it knows</button></h3>
      {chatter.length ? chatter.map((line) => <button type="button" className="v23-chatter" key={line.key} onClick={() => onOpen(line.key)}><span>{line.text}</span></button>) : <p>No team messages yet.</p>}
    </section>
    <section><h3>Just finished</h3>
      {finished.length ? finished.map((row) => <button type="button" className="v23-tower-row" key={row.key} onClick={() => onOpen(row.key)}><Face size={26} label={trunkName(row.agentId)} /><span className="v23-tower-row-text"><b>{row.title || trunkName(row.agentId)}</b><small>{[trunkName(row.agentId), row.duration].filter(Boolean).join(" · ")}</small></span><time className="v23-tower-time">{row.when}</time></button>) : <p>Nothing finished yet.</p>}
      <button type="button" className="v23-link" onClick={() => openTowerPlace("inbox", "History")}>All history</button>
    </section>
    <section><h3>Coming up <button type="button" className="v23-link" onClick={() => openTowerPlace("automations")}>Automations</button></h3>
      {coming.length ? coming.map((job) => <button type="button" className="v23-tower-row" key={job.id} onClick={() => openTowerPlace("automations")}><Face size={26} label={trunkName(job.trunkId)} /><span className="v23-tower-row-text"><b>{job.name}</b><small>{[job.when, trunkName(job.trunkId)].filter(Boolean).join(" · ")}</small></span></button>) : <p>Nothing scheduled.</p>}
    </section>
    <section><h3>Accounts <button type="button" className="v23-link" disabled={live.checking} onClick={() => void live.checkNow()}>{live.checking ? "Checking…" : "Check now"}</button></h3>
      {accounts.map((account) => {
        const five = account.fiveLeft !== null ? `${account.windowLabel}: ${account.fiveLeft}% left${account.reset ? ` · ${account.reset}` : ""}` : account.line;
        const week = account.weekLeft !== null ? `Week: ${account.weekLeft}% left` : "";
        return <button type="button" className={`v23-acct ${account.heat}`.trim()} key={account.id} onClick={() => openTowerSettings("accounts")} aria-label={`${account.email}, ${account.name}: ${five}${week ? `; ${week}` : ""}`}>
          <span className="v23-acct-name"><span className={`v23-acct-dot ${account.provider}`} aria-hidden="true" />{account.email}</span>
          <span className="v23-acct-left">{five}</span>
          {account.fiveLeft !== null ? <span className="v23-meter" aria-hidden="true"><i style={{ width: `${account.meter}%` }} /></span> : null}
          <small>{[account.name, account.plan, week].filter(Boolean).join(" · ")}</small>
        </button>;
      })}
      {live.checkError ? <p role="alert">{live.checkError}</p> : null}
      <p>{live.limits ? `${checkedLine(live.limits.updatedAt)} · ` : null}<button type="button" className="v23-link" onClick={() => openTowerSettings("accounts")}>Add an account</button></p>
    </section>
    {known ? <Menu at={known.at} items={known.items} onClose={() => setKnown(null)} label="Who it knows" testid="who-it-knows" /> : null}
  </aside>;
}
