// A running card's live run, in its sheet's Live run tab: what it is doing now, its approvals, steer, stop, pause its goal,
// and its helpers with stop. Its steps stream in below, filtered to this run and its helpers.
import { useState } from "react";
import { Dialog } from "../../shell/Dialog";
import { rec, resolveApproval, str, type Row } from "../automations/runtime";
import { goalOf, isRunning, sessionTitle, stepOf, trunkName } from "./data";
import { EveryStep } from "./Live";
import { Glyph } from "./glyphs";
import { TrunkFace, type Ctx } from "./ui";

const goalOp = (agentId: string, sessionKey: string, goalId: string, action: "pause" | "resume") => ({
  sessionKey, ...(agentId ? { agentId } : {}), goalId, action, operationId: crypto.randomUUID(), issuedAtMs: Date.now(),
});

export function LiveRun({ ctx, c }: { ctx: Ctx; c: Row }) {
  const key = str(c.sessionKey);
  if (!key) return <p className="cn-hint cn-flush">No conversation yet. Start a Trunk on this card and its run shows here.</p>;
  const session: Row = ctx.d.sessions.find(s => str(s.key) === key) ?? {};
  const helpers = ctx.d.sessions.filter(h => str(h.parentSessionKey) === key || str(h.spawnedBy) === key);
  const asks = ctx.d.pending.filter(p => str(rec(p.request).sessionKey) === key);
  const name = trunkName(ctx.d, str(c.agentId) || ctx.d.defaultTrunk), live = isRunning(session);
  return <>
    <div className="cn-who"><TrunkFace name={name} size={34} working={live} />
      <span className="cn-grow"><b>{name}</b><small>{stepOf(session) || (live ? "Working" : "Not running right now")}</small></span></div>
    {asks.map(p => <Ask key={str(p.id)} ctx={ctx} item={p} name={name} />)}
    {live ? <Steer ctx={ctx} sessionKey={key} name={name} /> : null}
    {live ? <LiveActs ctx={ctx} session={session} agentId={str(c.agentId)} name={name} /> : null}
    {helpers.length ? <Helpers ctx={ctx} list={helpers} name={name} /> : null}
    <EveryStep ctx={ctx} sessionKeys={[key, ...helpers.map(h => str(h.key))]} />
  </>;
}

function Ask({ ctx, item, name }: { ctx: Ctx; item: Row; name: string }) {
  const off = !ctx.approve || ctx.busy, command = str(rec(item.request).command);
  return <div className="cn-prow cn-ask">
    <span className="cn-grow"><b>{name} needs your yes</b><small>{command || "A step is waiting for your answer."}</small></span>
    <button className="btn ghost sm" type="button" disabled={off} onClick={() => void ctx.act(() => resolveApproval(ctx.engine, item, "deny"), `Said no. ${name} won’t do it.`)}>Don’t allow</button>
    <button className="btn pri sm" type="button" disabled={off} onClick={() => void ctx.act(() => resolveApproval(ctx.engine, item, "allow-once"), `Allowed. ${name} carries on.`)}>Allow</button>
  </div>;
}

function Steer({ ctx, sessionKey, name }: { ctx: Ctx; sessionKey: string; name: string }) {
  const [text, setText] = useState("");
  const label = `Tell ${name} what to change`;
  const send = () => void ctx.act(async () => {
    const result = rec(await ctx.engine.request("chat.send", { sessionKey, message: text.trim(), queueMode: "steer", idempotencyKey: crypto.randomUUID() }));
    if (result.status === "error") throw new Error(str(result.error) || "The steer message was rejected.");
    setText("");
    return result;
  }, `Steered ${name}. It picks this up at its next step.`);
  return <form className="cn-steer" onSubmit={e => { e.preventDefault(); if (text.trim()) send(); }}>
    <input className="inp" value={text} placeholder={label} aria-label={label} autoComplete="off" onChange={e => setText(e.target.value)} />
    <button className="btn pri sm" type="submit" disabled={!ctx.write || ctx.busy || !text.trim()}>Steer now</button>
  </form>;
}

function LiveActs({ ctx, session, agentId, name }: { ctx: Ctx; session: Row; agentId: string; name: string }) {
  const [asking, setAsking] = useState(false), key = str(session.key), goal = goalOf(session), canPause = goal?.status === "active";
  return <div className="cn-acts">
    <button className="btn ghost sm" type="button" disabled={!canPause || !ctx.write || ctx.busy} title={canPause ? undefined : "Pausing needs a goal that is running."} onClick={() => setAsking(true)}>Pause</button>
    <button className="btn ghost sm cn-stop" type="button" disabled={!ctx.write || ctx.busy} onClick={() => void ctx.act(() => ctx.engine.request("sessions.abort", { key }), "Stopped. What it did so far is kept.")}>Stop</button>
    {asking ? <PauseDialog ctx={ctx} agentId={agentId} sessionKey={key} goalId={str(goal?.id)} name={name} step={stepOf(session)} close={() => setAsking(false)} /> : null}
  </div>;
}

/** Pause <name>?: after the current task (a goal pause), or now (a goal pause, then the run stops). */
function PauseDialog({ ctx, agentId, sessionKey, goalId, name, step, close }: { ctx: Ctx; agentId: string; sessionKey: string; goalId: string; name: string; step: string; close: () => void }) {
  const [now, setNow] = useState(false);
  const go = () => void ctx.act(async () => {
    const res = await ctx.engine.request("sessions.goal.update", goalOp(agentId, sessionKey, goalId, "pause"));
    if (now) await ctx.engine.request("sessions.abort", { key: sessionKey });
    return res;
  }, now ? `${name} is paused.` : `${name} will pause when this task ends.`).then(ok => ok && close());
  return (
    <Dialog title={`Pause ${name}?`} onClose={close} footer={<><button className="btn ghost" type="button" onClick={close}>Cancel</button><button className="btn pri" type="button" disabled={ctx.busy} onClick={go}>Pause</button></>}>
      <p className="lede cn-flush">{name} is working. While paused, nothing new starts: schedules, triggers and messages wait until you resume.</p>
      <div className="cn-opts" role="radiogroup" aria-label="When to pause">
        <label className="cn-opt"><input type="radio" name="cn-pause" checked={!now} onChange={() => setNow(false)} /><b>When the current task ends</b><small>{step || "It finishes first."}</small></label>
        <label className="cn-opt"><input type="radio" name="cn-pause" checked={now} onChange={() => setNow(true)} /><b>Now</b><small>Stops what’s running. Nothing half-done is sent, and checkpoints stay.</small></label>
      </div>
    </Dialog>
  );
}

function Helpers({ ctx, list, name }: { ctx: Ctx; list: Row[]; name: string }) {
  return <section className="cn-hp" aria-label="Helpers">
    <h3 className="cn-hpt">{list.length} {list.length === 1 ? "helper" : "helpers"}</h3>
    <ul className="cn-hpl">{list.map(h => {
      const key = str(h.key), title = sessionTitle(h), running = isRunning(h) || str(h.status) === "running", done = str(h.status) === "done";
      return <li key={key}>
        <span className={`cn-hmark ${running ? "run" : done ? "done" : "no"}`} role="img" aria-label={running ? "Working" : done ? "Done" : "Stopped"} />
        <b>{title}</b>
        <small>{running ? stepOf(h) || "Working" : done ? "Done" : `Stopped. ${name} carries on without it.`}</small>
        {running ? <button type="button" className="ib sm cn-hstop" aria-label={`Stop ${title}`} title={`Stop ${title}`} disabled={!ctx.write || ctx.busy}
          onClick={() => void ctx.act(() => ctx.engine.request("sessions.abort", { key }), `Stopped ${title}. Its Trunk carries on without it.`)}><Glyph name="stop" /></button> : null}
      </li>;
    })}</ul>
  </section>;
}
