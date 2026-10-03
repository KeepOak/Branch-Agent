// One run on Canopy › Now (§4.6.7 run card): face, Trunk, task, step · time · computer · model, meter, and its actions.
import { useState } from "react";
import { Dialog } from "../../shell/Dialog";
import { rec, resolveApproval, str } from "../automations/runtime";
import { BLOCK, people, trunkName, WAYOUT, type Run } from "./data";
import { Glyph } from "./glyphs";
import { anchorOf, ChoiceMenu, clock, Nobody, Pill, sinceWords, TrunkFace, type Ctx } from "./ui";
import type { MenuAnchor } from "../../shell/Menu";

const goalId = (r: Run) => ({
  sessionKey: r.sessionKey, ...(r.agentId ? { agentId: r.agentId } : {}), goalId: str(r.goal?.id),
  operationId: crypto.randomUUID(), issuedAtMs: Date.now(),
});
const goalOp = (r: Run, action: "pause" | "resume") => ({ ...goalId(r), action });

function metaLine(r: Run, ctx: Ctx): string {
  const comp = ctx.comps.find(c => c.id === r.comp);
  if (r.col === "done") return [r.step, clock(r.at), comp?.name].filter(Boolean).join(" · ");
  if (r.col === "next") return [r.when || r.step, comp?.name].filter(Boolean).join(" · ");
  if (comp?.state === "off") return `Last seen ${clock(comp.lastSeen) || "a while ago"} · ${comp.name}`;
  return [r.step, sinceWords(r.since, ctx.now), comp?.name, r.model].filter(Boolean).join(" · ");
}

export function RunCard({ r, ctx, steering, setSteering }: { r: Run; ctx: Ctx; steering: boolean; setSteering: (key: string | null) => void }) {
  const name = r.agentId ? trunkName(ctx.d, r.agentId) : "";
  const open = () => r.card ? ctx.openCard(str(r.card.id)) : r.sessionKey ? ctx.openConversation(r.sessionKey) : r.kind === "sched" ? ctx.openPlace("automations") : undefined;
  const body = (
    <span className="cn-run-b">
      {name ? <TrunkFace name={name} size={30} working={r.col === "working"} /> : <Nobody size={30} />}
      <span className="cn-grow">
        <b>{name || "Nobody yet"}</b>
        <span className="cn-task">{r.task}</span>
        <small>{metaLine(r, ctx)}</small>
        {r.pct !== undefined ? <span className="cn-meter" role="meter" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct}><u style={{ width: `${r.pct}%` }} /></span> : null}
      </span>
    </span>
  );
  const starter = r.who && ctx.d.viewer && r.who !== ctx.d.viewer ? people(ctx.d).find(p => p.id === r.who) : undefined;
  return (
    <div className={r.col === "waiting" ? "cn-run wait" : "cn-run"} role="listitem" data-run={r.key}>
      {starter ? <div className="cn-run-h"><span className="cn-initial" aria-hidden="true">{starter.name.charAt(0).toUpperCase()}</span><small>{starter.name.split(" ")[0]} started it</small></div> : null}
      <button type="button" className="cn-run-open" aria-label={`Open ${name}: ${r.task}`} onClick={open}>{body}</button>
      {r.col === "stuck" && r.why ? <Pill tone={BLOCK[r.why][0]} tip={r.detail}>{BLOCK[r.why][1]}</Pill> : null}
      {r.board && r.col !== "stuck" ? <button type="button" className="cn-lnk" onClick={() => ctx.openCard(str(r.board?.id))}>On the board: {str(r.board.title)}</button> : null}
      {steering ? <SteerForm r={r} ctx={ctx} name={name} done={() => setSteering(null)} /> : null}
      {r.col === "working" && r.helpers?.length ? <Helpers r={r} ctx={ctx} /> : null}
      {r.col === "done" ? null : <div className="cn-acts"><RunActs r={r} ctx={ctx} steer={() => setSteering(steering ? null : r.key)} /></div>}
    </div>
  );
}

function SteerForm({ r, ctx, name, done }: { r: Run; ctx: Ctx; name: string; done: () => void }) {
  const [text, setText] = useState("");
  const label = `Tell ${name || "it"} what to change`;
  const send = () => ctx.act(async () => {
    const result = rec(await ctx.engine.request("chat.send", { sessionKey: r.sessionKey, message: text.trim(), queueMode: "steer", idempotencyKey: crypto.randomUUID() }));
    if (result.status === "error") throw new Error(str(result.error) || "The steer message was rejected.");
    done();
    return result;
  }, `Steered ${name || "it"}. It picks this up at its next step.`);
  return (
    <form className="cn-steer" onSubmit={e => { e.preventDefault(); if (text.trim()) void send(); }}>
      <input className="inp" autoFocus value={text} placeholder={label} aria-label={label} autoComplete="off" aria-invalid={false}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); done(); } }} />
      <button className="btn pri sm" type="submit" disabled={!ctx.write || ctx.busy || !text.trim()}>Steer now</button>
    </form>
  );
}

function Helpers({ r, ctx }: { r: Run; ctx: Ctx }) {
  const [open, setOpen] = useState(false), list = r.helpers ?? [];
  const words = { run: "Working", wait: "Waiting for you", done: "Done", no: "Stopped" };
  return (
    <div className="cn-hp">
      <button type="button" className="cn-hpt" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={open ? "cn-chev open" : "cn-chev"} aria-hidden="true">›</span>{list.length} {list.length === 1 ? "helper" : "helpers"}
      </button>
      {open ? <ul className="cn-hpl">{list.map(h => (
        <li key={h.key}>
          <span className={`cn-hmark ${h.mark}`} role="img" aria-label={words[h.mark]} />
          <b>{h.name}</b>
          <small>{h.mark === "no" ? `Stopped. ${trunkName(ctx.d, r.agentId)} carries on without it.` : h.step || words[h.mark]}</small>
          {h.mark === "run" || h.mark === "wait" ? <button type="button" className="ib sm cn-hstop" aria-label={`Stop ${h.name}`} title={`Stop ${h.name}`} disabled={!ctx.write || ctx.busy}
            onClick={() => void ctx.act(() => ctx.engine.request("sessions.abort", { key: h.key }), `Stopped ${h.name}. Its Trunk carries on without it.`)}><Glyph name="stop" /></button> : null}
        </li>))}</ul> : null}
    </div>
  );
}

function RunActs({ r, ctx, steer }: { r: Run; ctx: Ctx; steer: () => void }) {
  if (r.col === "waiting") return <WaitActs r={r} ctx={ctx} />;
  if (r.col === "working") return <WorkActs r={r} ctx={ctx} steer={steer} />;
  if (r.col === "next") return <NextActs r={r} ctx={ctx} />;
  if (r.col === "stuck") return <StuckActs r={r} ctx={ctx} />;
  return null;
}

function WaitActs({ r, ctx }: { r: Run; ctx: Ctx }) {
  const item = r.ask ?? {}, off = !ctx.approve || ctx.busy, name = trunkName(ctx.d, r.agentId);
  return <>
    <button className="btn ghost sm" type="button" disabled={off} onClick={() => void ctx.act(() => resolveApproval(ctx.engine, item, "deny"), `Said no. ${name} won’t do it.`)}>Don’t</button>
    {r.sessionKey ? <button className="btn sm" type="button" onClick={() => ctx.openConversation(str(r.sessionKey))}>Open</button> : null}
    <button className="btn pri sm" type="button" disabled={off} onClick={() => void ctx.act(() => resolveApproval(ctx.engine, item, "allow-once"), `Allowed. ${name} carries on.`)}>Allow</button>
  </>;
}

function WorkActs({ r, ctx, steer }: { r: Run; ctx: Ctx; steer: () => void }) {
  const name = trunkName(ctx.d, r.agentId), canPause = r.goal?.status === "active", [asking, setAsking] = useState(false);
  return <>
    <button className="btn sm" type="button" disabled={!ctx.write || !r.sessionKey} onClick={steer}><Glyph name="chat" />Steer</button>
    <button className="btn ghost sm" type="button" disabled={!canPause || !ctx.write || ctx.busy} title={canPause ? undefined : "Needs the engine's per-run pause method."}
      onClick={() => setAsking(true)}>Pause</button>
    {asking ? <PauseDialog r={r} ctx={ctx} name={name} close={() => setAsking(false)} /> : null}
    <button className="btn ghost sm cn-stop" type="button" disabled={!ctx.write || ctx.busy} onClick={() => void ctx.act(() => ctx.engine.request("sessions.abort", { key: r.sessionKey }), "Stopped. What it did so far is kept.")}>Stop</button>
  </>;
}

/** The preview's "Pause <name>?" (pauseDlg17c): after the current task (goal pause), or now (goal pause, then stop the run). */
function PauseDialog({ r, ctx, name, close }: { r: Run; ctx: Ctx; name: string; close: () => void }) {
  const [now, setNow] = useState(false);
  const go = () => void ctx.act(async () => {
    const res = await ctx.engine.request("sessions.goal.update", goalOp(r, "pause"));
    if (now) await ctx.engine.request("sessions.abort", { key: r.sessionKey });
    return res;
  }, now ? `${name} is paused.` : `${name} will pause when this task ends.`).then(ok => ok && close());
  return (
    <Dialog title={`Pause ${name}?`} onClose={close} footer={<><button className="btn ghost" type="button" onClick={close}>Cancel</button><button className="btn pri" type="button" disabled={ctx.busy} onClick={go}>Pause</button></>}>
      <p className="lede cn-flush">{name} is working. While paused, nothing new starts: schedules, triggers and messages wait until you resume.</p>
      <div className="cn-opts" role="radiogroup" aria-label="When to pause">
        <label className="cn-opt"><input type="radio" name="cn-pause" checked={!now} onChange={() => setNow(false)} /><b>When the current task ends</b><small>{r.step || "It finishes first."}</small></label>
        <label className="cn-opt"><input type="radio" name="cn-pause" checked={now} onChange={() => setNow(true)} /><b>Now</b><small>Stops what’s running. Nothing half-done is sent, and checkpoints stay.</small></label>
      </div>
    </Dialog>
  );
}

function NextActs({ r, ctx }: { r: Run; ctx: Ctx }) {
  const name = trunkName(ctx.d, r.agentId), off = !ctx.write || ctx.busy;
  if (r.kind === "paused") return <>
    <button className="btn sm" type="button" disabled={off} onClick={() => void ctx.act(() => ctx.engine.request("sessions.goal.update", goalOp(r, "resume")), `${name} is back.`)}>Resume</button>
    <button className="btn ghost sm cn-stop" type="button" disabled={off} onClick={() => void ctx.act(() => ctx.engine.request("sessions.goal.clear", goalId(r)), "Stopped. What it did so far is kept.")}>Stop</button>
  </>;
  const start = r.kind === "card"
    ? () => ctx.act(() => ctx.engine.request("canopy.cards.start", { id: str(r.card?.id) }), `Started ${name} on “${r.task}”.`)
    : () => ctx.act(async () => { const res = rec(await ctx.engine.request("cron.run", { id: str(r.job?.id), mode: "force" })); if (res.ran === false || res.enqueued === false) throw new Error(str(res.reason) || "The engine did not queue this run."); return res; }, `Running ${r.task} now.`);
  return <>
    <button className="btn sm" type="button" disabled={off} onClick={() => void start()}>Start now</button>
    <SkipButton r={r} />
  </>;
}

/** The engine can't skip a schedule's single run, nor pass over a Ready card while it stays Ready (the preview's Skip). */
function SkipButton({ r }: { r: Run }) {
  return <button className="btn ghost sm" type="button" disabled title={r.kind === "card" ? "Needs the engine's skip method for Ready cards." : "Needs the engine's skip-next-run method."}>Skip</button>;
}

function StuckActs({ r, ctx }: { r: Run; ctx: Ctx }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const id = str(r.card?.id), off = !ctx.write || ctx.busy, gone = !r.agentId || !ctx.d.trunks.some(t => t.id === r.agentId);
  const way = () => {
    if (r.card && r.why === "failed") return void ctx.act(async () => { await ctx.engine.request("canopy.cards.unblock", { id }); return ctx.engine.request("canopy.cards.start", { id }); }, "Trying again. It’s back in Running.");
    if (r.card) return ctx.openCard(id);
    if (r.sessionKey) ctx.openConversation(r.sessionKey);
  };
  const hand = (agentId: string) => { setMenu(null); void ctx.act(() => ctx.engine.request("canopy.cards.reassign", { id, agentId }), `Handed to ${trunkName(ctx.d, agentId)}.`); };
  return <>
    <button className="btn sm" type="button" disabled={r.why === "failed" && off} onClick={way}>{r.why ? WAYOUT[r.why] : "Answer"}</button>
    {r.card && gone ? <button className="btn ghost sm" type="button" aria-haspopup="menu" disabled={off} onClick={e => setMenu(anchorOf(e.currentTarget))}>Hand to…</button> : null}
    {menu ? <ChoiceMenu at={menu} label="Hand to" head="Hand to" radio onClose={() => setMenu(null)} onPick={hand}
      options={ctx.d.trunks.filter(t => t.id !== r.agentId).map(t => ({ id: t.id, checked: false, label: <><TrunkFace name={t.name} size={20} /> {t.name}</> }))} /> : null}
  </>;
}
