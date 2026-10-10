// Live steps and background tasks for the Board: "Every step, live" (a card's own run, or every run when unfiltered) and "Background tasks".
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shell/icons";
import { stepLabel } from "../../thread/format";
import { readFileChanges, resultText, type Block, type FileChange } from "../../thread/model";
import { displayToolOutput } from "../../thread/tool-output-display";
import { rec, str } from "../automations/runtime";
import { isRunning, sessionTitle, trunkName } from "./data";
import type { MenuAnchor } from "../../shell/Menu";
import { anchorOf, ChoiceMenu, clock, Pill, TrunkFace, type Ctx } from "./ui";

type Step = { key: string; session: string; tool: string; changes: FileChange[]; hidden: number; st: "Running" | "Done" | "Error"; out: string; at: number };
const STATUS = { Running: "running", Done: "ok", Error: "failed" } as const;

/** What a step did, in the thread's plain words ("Edited 2 files", "Ran a command"), never its tool id. */
function said(s: Pick<Step, "key" | "tool" | "changes" | "st">): string {
  const step: Extract<Block, { kind: "step" }> = { kind: "step", key: s.key, tool: s.tool, title: "", detail: "", status: STATUS[s.st], changes: s.changes };
  return stepLabel(step);
}
const KEEP = 100;

/** Tool steps from every conversation as they arrive, from the moment this view opens (the list starts again when Canopy closes).
 * The window's session subscription receives every conversation's tool lifecycle as "session.tool" (engine server-chat.ts);
 * runs this window started also arrive as "agent" events. */
function useSteps(ctx: Ctx) {
  const [steps, setSteps] = useState<Step[]>([]);
  useEffect(() => ctx.engine.onEvent(({ event, payload }) => {
    const p = rec(payload), d = rec(p.data);
    if ((event !== "agent" && event !== "session.tool") || p.stream !== "tool" || ["tool_call", "tool_search", "tool_describe"].includes(str(d.name))) return;
    const key = str(d.toolCallId) || `${str(p.runId)}:${String(p.seq)}`;
    setSteps(list => {
      if (d.phase === "start") return [{ key, session: str(p.sessionKey), tool: str(d.name) || "step", changes: readFileChanges(d.args), hidden: Object.keys(rec(d.args)).length, st: "Running" as const, out: "", at: Date.now() }, ...list.filter(s => s.key !== key)].slice(0, KEEP);
      if (d.phase !== "result" || !list.some(x => x.key === key)) return list;
      return list.map(s => s.key === key ? { ...s, st: d.isError ? "Error" as const : "Done" as const, out: displayToolOutput({ tool: s.tool, text: resultText(d.result) }).slice(0, 120) } : s);
    });
  }), [ctx.engine]);
  return [steps, setSteps] as const;
}

/** The steps of one run and its helpers (sessionKeys), or of every run when no keys are given. */
export function EveryStep({ ctx, sessionKeys }: { ctx: Ctx; sessionKeys?: string[] }) {
  const [steps, setSteps] = useSteps(ctx);
  const [q, setQ] = useState(""), [tool, setTool] = useState(""), [st, setSt] = useState<string[]>([]), [follow, setFollow] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({}), [menu, setMenu] = useState<MenuAnchor | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const title = (s: Step) => sessionTitle(ctx.d.sessions.find(x => str(x.key) === s.session) ?? {});
  const agent = (s: Step) => trunkName(ctx.d, str(ctx.d.sessions.find(x => str(x.key) === s.session)?.agentId) || s.session.split(":")[1] || "");
  const list = steps.filter(s => (!sessionKeys || sessionKeys.includes(s.session)) && (!tool || s.tool === tool) && (!st.length || st.includes(s.st)) && (!q || [said(s), s.tool, s.out, title(s), agent(s)].some(x => x.toLowerCase().includes(q.toLowerCase()))));
  useEffect(() => { if (follow && box.current) box.current.scrollTop = 0; }, [steps, follow]);
  const tools = [...new Set(steps.map(s => s.tool))];
  return (
    <section className="cn-sec cn-steps" aria-label="Every step, live">
      <h2>Every step, live</h2>
      <div className="cn-stf">
        <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by step, summary, run or conversation" aria-label="Filter by step, summary, run or conversation" />
        <button className="btn sm" type="button" aria-haspopup="menu" onClick={e => setMenu(menu ? null : anchorOf(e.currentTarget))}>{tool ? said({ key: tool, tool, changes: [], st: "Done" }) : "All tools"}<Icon name="down" /></button>
        {(["Running", "Done", "Error"] as const).map(s => <button key={s} className="btn sm cn-chipb" type="button" aria-pressed={st.includes(s)} onClick={() => setSt(st.includes(s) ? st.filter(x => x !== s) : [...st, s])}>{s}</button>)}
        <label className="cn-sw"><button type="button" role="switch" className="switch" aria-checked={follow} aria-label="Follow" onClick={() => setFollow(!follow)} /><b>Follow</b></label>
        <button className="btn ghost sm" type="button" onClick={() => setOpen(Object.fromEntries(steps.map(s => [s.key, true])))}>Open all</button>
        <button className="btn ghost sm" type="button" onClick={() => setOpen({})}>Fold all</button>
        <button className="btn ghost sm" type="button" title="Clears this list only; nothing stops." onClick={() => setSteps([])}>Clear</button>
      </div>
      {menu ? <ChoiceMenu at={menu} label="Tool" head="Tool" radio onClose={() => setMenu(null)} onPick={id => { setTool(id); setMenu(null); }}
        options={[{ id: "", label: "All tools", checked: !tool }, ...tools.map(t => ({ id: t, label: said({ key: t, tool: t, changes: [], st: "Done" }), checked: tool === t }))]} /> : null}
      {list.length ? <div className="cn-rows cn-stlist" ref={box}>{list.map(s => (
        <div className="cn-prow" key={s.key}>
          <span className="cn-tile"><Icon name="search" /></span>
          <span className="cn-grow"><b>{said(s)} <TrunkFace name={agent(s)} size={20} /> {agent(s)}</b>
            <small>{title(s)} · {s.hidden} {s.hidden === 1 ? "detail" : "details"} hidden</small>
            {open[s.key] ? <small className="cn-stout">{s.out ? `${s.out} · Shortened and cleaned.` : "No preview."}</small> : null}</span>
          <Pill tone={s.st === "Running" ? "wait" : s.st === "Error" ? "bad" : "ok"}>{s.st}</Pill>
          <button className="ib sm" type="button" aria-expanded={!!open[s.key]} title={open[s.key] ? "Fold" : "Show the output"} aria-label={open[s.key] ? "Fold" : "Show the output"} onClick={() => setOpen({ ...open, [s.key]: !open[s.key] })}><Icon name={open[s.key] ? "down" : "chev"} /></button>
        </div>))}</div> : <p className="cn-hint">Nothing yet. Steps show here while this view is open.</p>}
      <p className="cn-hint">{list.length} of {steps.length} · Keeps the last {KEEP} and starts again when you leave this view.</p>
    </section>
  );
}

/** Background tasks with the controls that work: Open, and Stop while one is running. */
export function BackgroundTasks({ ctx }: { ctx: Ctx }) {
  const tasks = ctx.d.sessions.filter(s => s.isBackground === true && s.archived !== true);
  return (
    <section className="cn-sec" aria-label="Background tasks">
      <h2>Background tasks</h2>
      {tasks.length ? <div className="cn-rows">{tasks.map(t => {
        const name = trunkName(ctx.d, str(t.agentId)), key = str(t.key), live = isRunning(t);
        return <div className="cn-prow" key={key}>
          <TrunkFace name={name} size={20} working={live} />
          <span className="cn-grow"><b>{sessionTitle(t)}</b><small>{live ? "Running" : str(t.status) || "Idle"} · started {clock(Number(t.startedAt) || Number(t.createdAt))}</small></span>
          <button className="btn sm" type="button" onClick={() => ctx.openConversation(key)}>Open</button>
          {live ? <button className="btn ghost sm cn-stop" type="button" disabled={!ctx.write || ctx.busy} onClick={() => void ctx.act(() => ctx.engine.request("sessions.abort", { key }), "Stopped. What it did so far is kept.")}>Stop</button> : null}
        </div>; })}</div> : <p className="cn-hint">No background tasks.</p>}
    </section>
  );
}
