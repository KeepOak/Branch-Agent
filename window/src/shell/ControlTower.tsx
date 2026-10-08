import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { approvals, canApprove, rec, resolveApproval, str, usePlaceData } from "../places/inbox/data";
import { approvalTitle } from "../places/inbox/NeedsYou";
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
  trunkList,
} from "./control-tower-data";
import type { Limits } from "./status-data";
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
  const [checkError, setCheckError] = useState<string | null>(null);
  const [trunks, setTrunks] = useState<{ defaultId: string; list: { id: string; name: string }[]; ready: boolean }>({ defaultId: "", list: [], ready: false });
  const workingKeys = useRef<string[]>([]);

  const rememberEnded = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setEndedKeys((prev) => [...keys, ...prev.filter((key) => !keys.includes(key))].slice(0, 4));
  }, []);

  const load = useCallback(async () => {
    const [usage, cron, cfg, activity, listed] = await Promise.all([
      engine.request("usage.status", {}).catch(() => null),
      engine.request("cron.list", { limit: 200 }).catch(() => ({})),
      engine.request("config.get", {}).catch(() => ({})),
      engine.request("audit.activity.list", { kind: "agent_run", limit: 200 }).catch(() =>
        engine.request("audit.list", { kind: "agent_run", limit: 200 }).catch(() => ({}))),
      engine.request("agents.list", {}).catch(() => ({})),
    ]);
    setLimits(readUsage(usage ?? {}));
    setJobs(readCronJobs(cron));
    setLocked(readLocked(cfg));
    setAudit(activity);
    setTrunks({ ...trunkList(listed), ready: true });
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
      if (event === "chat") {
        const body = rec(payload);
        if (["final", "error", "aborted"].includes(str(body.state))) {
          const key = str(body.sessionKey);
          if (key) rememberEnded([key]);
          void load();
        }
      }
    });
    const onUsage = () => { void load(); };
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
      setLimits(readUsage(result));
      window.dispatchEvent(new Event("branch:usage-checked"));
    } catch {
      setCheckError("Couldn’t check accounts right now. Branch will try again.");
    } finally {
      setChecking(false);
    }
  }, [checking, engine]);

  return { limits, jobs, audit, endedKeys, locked, checking, checkError, trunks, checkNow };
}

/** Live Control tower. The preview's sample approvals and jobs are never shown as real data. */
export function ControlTower({ engine, rows, needsCount, trunkName, onOpen, onInbox, onClose }: Props) {
  const queue = usePlaceData(engine, approvals);
  const live = useTowerLive(engine, rows);
  const pending = queue.data?.items ?? [];
  const working = rows.filter((row) => row.working && !row.archived && !row.helper && !row.system);
  const jobs = rows.filter((row) => row.working && !row.archived && row.helper && !row.system);
  const chatter = towerChatter(rows);
  const finished = towerFinished(rows, live.audit, Date.now(), live.endedKeys);
  const coming = towerComingUp(live.jobs);
  const accounts = towerAccounts(live.limits);
  const health = towerHealth(live.locked, live.checking, live.limits);
  const [known, setKnown] = useState<{ at: MenuAnchor; items: MenuItem[] } | null>(null);
  const decide = (item: Record<string, unknown>, decision: "allow-once" | "deny") => void queue.act(() => resolveApproval(engine, item, decision), decision === "deny" ? "Said no." : "Allowed once.");
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
    <section><h3>Needs you {needsCount ? <span>{needsCount}</span> : null}</h3>
      {queue.error ? <p role="alert">{queue.error}</p> : null}
      {!pending.length && !needsCount ? <p>Nothing is waiting for you.</p> : null}
      {pending.slice(0, 5).map((item) => {
        const request = rec(item.request), decisions = Array.isArray(request.allowedDecisions) ? request.allowedDecisions : ["allow-once", "deny"];
        const expired = typeof item.expiresAtMs === "number" && item.expiresAtMs <= Date.now();
        const key = str(request.sessionKey), who = trunkName(str(request.agentId));
        return <div className="v23-tower-row" key={`${str(item.kind)}:${str(item.id)}`}>
          <Face size={26} label={who} /><button type="button" className="v23-tower-row-text" disabled={!key} onClick={() => onOpen(key)}><b>{approvalTitle(item)}</b><small>{who} · {str(request.description) || str(item.kind)}</small></button>
          <button type="button" className="v23-allow" disabled={!canApprove(engine) || queue.busy || expired || !decisions.includes("allow-once")} onClick={() => decide(item, "allow-once")}>Allow</button>
          <button type="button" className="v23-deny" aria-label={`Don't allow ${approvalTitle(item)}`} disabled={!canApprove(engine) || queue.busy || expired || !decisions.includes("deny")} onClick={() => decide(item, "deny")}>×</button>
        </div>;
      })}
      {needsCount > pending.slice(0, 5).length ? <button type="button" className="v23-link" onClick={onInbox}>{needsCount - pending.slice(0, 5).length} more in the Inbox</button> : null}
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
