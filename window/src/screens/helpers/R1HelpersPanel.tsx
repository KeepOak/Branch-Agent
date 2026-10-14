// The Classic helpers view (Side panel › Activity: the step list with times, "Helpers on this task" and one card per
// helper with its job, model and account, Working/Done, cost, Stop and "What it's thinking"), re-hosted unchanged inside
// the R1 frame (parity row 3, README rule 6). Only this wrapper is R1: a clear glass panel (README item 48) beside the
// conversation, with the two item 44 controls the Classic view lacks: Stop all (3 or more live helpers, behind a confirm;
// sessions.abort per helper) and Tell it (sessions.send to one working helper). Each declares its engine call and shows
// Coming when this engine doesn't offer it (R1-10).
import { useState, type FormEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import type { Block } from "../../thread/model";
import { ActivityTab } from "../../stage/pane/ActivityTab";
import { useHelpers, type Helper } from "../../thread/useEngineData";
import "../../stage/stage.css";
import "../../stage/pane/pane.css";
import "./r1-helpers.css";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A helper that is still going: the Classic card's Working / waiting / stalled states, not Done or Stopped. */
export const isLive = (h: Helper): boolean => h.status === "running" || h.status === "queued" || !h.status;

type Props = { engine: WindowEngine; name: string; blocks: Block[]; running: boolean; focus?: number; onClose: () => void; onToast: (text: string) => void };

export function R1HelpersPanel({ engine, name, blocks, running, focus = 0, onClose, onToast }: Props) {
  const { helpers } = useHelpers(engine);
  const live = helpers.filter(isLive);
  const [confirming, setConfirming] = useState(false);
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = live.find((h) => h.key === target) ?? live[0];
  const stopAll = async () => {
    setConfirming(false); setBusy(true);
    const done = await Promise.allSettled(live.map((h) => engine.request("sessions.abort", { key: h.key })));
    setBusy(false);
    const failed = done.filter((d) => d.status === "rejected").length;
    onToast(failed ? `Stopped ${live.length - failed} of ${live.length} helpers.` : `Stopped ${live.length} helpers. ${name} carries on without them.`);
  };
  const tell = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!chosen || !message) return;
    setBusy(true);
    try {
      await engine.request("sessions.send", { key: chosen.key, message, idempotencyKey: crypto.randomUUID() });
      setText(""); onToast(`Told ${chosen.name}. It picks this up at its next step.`);
    } catch (e) { onToast(errorText(e)); }
    finally { setBusy(false); }
  };
  return <aside className="r1-helpers g-clear" aria-label="Activity" data-testid="r1-helpers">
    <div className="r1-helpers-head">
      <h2 className="g-label">Activity</h2>
      {live.length >= 3 ? <Coming engine={engine} need="sessions.abort" reason="This engine can’t stop helpers." where="Stop all">
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setConfirming(true)}>Stop all</button>
      </Coming> : null}
      <button type="button" className="btn ghost sm" data-local="" aria-label="Close activity" onClick={onClose}>Close</button>
    </div>
    {confirming ? <div className="r1-helpers-confirm" role="alertdialog" aria-label="Stop all helpers">
      <p className="g-label">{`Stop all ${live.length} working helpers? What they did so far is kept.`}</p>
      <button type="button" className="btn ghost sm" data-local="" onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" className="btn pri sm" onClick={() => void stopAll()}>{`Stop ${live.length}`}</button>
    </div> : null}
    <div className="r1-helpers-body pane-body pane-b-pn">
      <ActivityTab engine={engine} name={name} blocks={blocks} running={running} level="regular" focusHelpers={focus} onError={onToast} />
    </div>
    {live.length ? <form className="r1-helpers-tell" aria-label="Tell a helper" onSubmit={(e) => void tell(e)}>
      {live.length > 1 ? <select aria-label="Which helper" value={chosen?.key ?? ""} onChange={(e) => setTarget(e.target.value)}>
        {live.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
      </select> : null}
      <Coming engine={engine} need="sessions.send" reason="This engine can’t message a helper." where="Tell it">
        <input type="text" aria-label={`Tell ${chosen?.name ?? "it"}`} placeholder="Tell it…" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      </Coming>
      <Coming engine={engine} need="sessions.send" reason="This engine can’t message a helper." where="Send to helper">
        <button type="submit" className="btn sm" disabled={busy || !text.trim()}>Send</button>
      </Coming>
    </form> : null}
  </aside>;
}
