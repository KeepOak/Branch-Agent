// Library › Activity › Your day, once the Logbook tab (preview 42-placesbp libLogDrawPQ18) on logbook.*: off state with Turn on…, the capture status
// with Pause / Resume and Look now, the day picker, Day at a glance, the timeline, Daily standup and Ask your day.
import { useState, type FormEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { num, optStr, rec, recs, str, useOperation, useResource } from "./data";
import { EmptyIcon, IcoTile, Section, type LibIconName } from "./parts";

type Status = {
  captureEnabled: boolean; capturePaused: boolean; captureIntervalSeconds: number; nodeName?: string; nodeId?: string;
  lastCaptureError?: string; pendingFrames: number; analysisRunning: boolean; visionModelSource: "config" | "media-defaults" | "missing"; today: string;
};
type Card = { id: number; startMs: number; endMs: number; title: string; summary: string; category: string; distractions: { title: string }[] };
type Timeline = { day: string; cards: Card[]; stats: { trackedMs: number; distractionMs: number } };

const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function statusOf(raw: unknown): Status {
  const r = rec(raw), src = r.visionModelSource;
  return { captureEnabled: r.captureEnabled === true, capturePaused: r.capturePaused === true, captureIntervalSeconds: num(r.captureIntervalSeconds) ?? 0, nodeName: optStr(r.nodeName), nodeId: optStr(r.nodeId),
    lastCaptureError: optStr(r.lastCaptureError), pendingFrames: num(r.pendingFrames) ?? 0, analysisRunning: r.analysisRunning === true,
    visionModelSource: src === "config" || src === "media-defaults" ? src : "missing", today: /^\d{4}-\d{2}-\d{2}$/.test(str(r.today)) ? str(r.today) : localDay() };
}
function timelineOf(raw: unknown, day: string): Timeline {
  const r = rec(raw), stats = rec(r.stats);
  const cards = recs(r.cards).filter(c => typeof c.title === "string").map((c, i): Card => ({ id: num(c.id) ?? i, startMs: num(c.startMs) ?? 0, endMs: num(c.endMs) ?? 0, title: c.title as string, summary: str(c.summary), category: str(c.category),
    distractions: recs(c.distractions).filter(d => typeof d.title === "string").map(d => ({ title: d.title as string })) }));
  return { day, cards, stats: { trackedMs: num(stats.trackedMs) ?? 0, distractionMs: num(stats.distractionMs) ?? 0 } };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export function duration(ms: number) { const m = Math.round(ms / 60_000), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; }
export function dayWords(day: string) { const d = new Date(`${day}T12:00:00`); return `${d.toLocaleDateString("en-GB", { weekday: "long" })} ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "long" })}`; }
const ICONS: Record<string, LibIconName> = { code: "code", coding: "code", mail: "inbox", email: "inbox", meeting: "people", call: "people", browsing: "globe", research: "globe", writing: "file", docs: "file" };

type Props = { engine: WindowEngine; openSettings?: (page: string) => void };

export function LogbookTab({ engine, openSettings }: Props) {
  const raw = useResource<unknown>(engine, "logbook.status");
  const status = { ...raw, data: raw.data === null ? null : statusOf(raw.data) };
  const hint = <p className="lib-hint lib-mhint">Your day, built from pictures of your screen.</p>;
  if (status.loading) return <>{hint}<p className="lib-hint" role="status">Loading…</p></>;
  if (!status.data || !status.data.captureEnabled) return <>{hint}
    <EmptyLine icon={<EmptyIcon name="camera" />}><b>Logbook is off</b><br />It builds a timeline of your day from pictures of your screen. The model that reads them sees them.<br />
      <button type="button" className="btn sm" disabled={!openSettings} title={openSettings ? undefined : "Needs the window’s Settings to turn Logbook on."} onClick={() => openSettings?.("computer")}>Turn on…</button></EmptyLine>
    {status.error && <p className="lib-hint" data-testid="logbook-engine">{status.error}</p>}
  </>;
  return <>{hint}<On engine={engine} status={status.data} reload={status.reload} openSettings={openSettings} /></>;
}

function On({ engine, status, reload, openSettings }: Props & { status: Status; reload: () => void }) {
  const op = useOperation(engine);
  const days = useResource<unknown>(engine, "logbook.days");
  const [day, setDay] = useState(status.today);
  const list = [...new Set([status.today, ...recs(rec(days.data).days).map(d => str(d.day)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))])].sort().reverse();
  const at = list.indexOf(day);
  const problem = status.lastCaptureError ? "Couldn’t take a picture" : status.visionModelSource === "missing" ? "No model that can read pictures" : null;
  const title = problem ?? (status.capturePaused ? "Paused" : `Taking a picture every ${status.captureIntervalSeconds} s`);
  return <>
    <div className="lib-card lib-logst" data-testid="logbook-status">
      <span className={`lib-dot${problem ? " bad" : status.capturePaused ? " idle" : ""}`} />
      <div className="lib-grow"><b>{title}</b>
        <p>From {status.nodeName || status.nodeId || "this computer"} · <span title="Pictures waiting for the next look">{status.pendingFrames} pictures waiting</span></p>
        {status.lastCaptureError && <p className="lib-bad">{status.lastCaptureError}</p>}
        {status.visionModelSource === "missing" && openSettings && <div className="lib-acts"><button type="button" className="btn sm" onClick={() => openSettings("models")}>Choose one</button></div>}
      </div>
      <span className="lib-card-acts">
        <button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("logbook.capture.set", { paused: !status.capturePaused }, reload)}>{status.capturePaused ? "Resume" : "Pause"}</button>
        <button type="button" className="btn sm" disabled={op.busy || status.analysisRunning || !status.pendingFrames} onClick={() => void op.run("logbook.analyze.now", {}, reload)}>Look now</button>
      </span>
    </div>
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
    <div className="lib-day">
      <button type="button" className="ib" aria-label="Previous day" disabled={at < 0 || at >= list.length - 1} onClick={() => setDay(list[at + 1])}>‹</button>
      <b>{dayWords(day)}</b>
      <button type="button" className="ib" aria-label="Next day" disabled={at <= 0} onClick={() => setDay(list[at - 1])}>›</button>
      <button type="button" className="btn sm" disabled={day === status.today} onClick={() => setDay(status.today)}>Today</button>
    </div>
    <Day key={day} engine={engine} day={day} />
  </>;
}

function Day({ engine, day }: { engine: WindowEngine; day: string }) {
  const timeline = useResource<unknown>(engine, "logbook.timeline", { day });
  const t = timeline.data === null ? null : timelineOf(timeline.data, day);
  const focus = t && t.stats.trackedMs ? Math.round((100 * Math.max(0, t.stats.trackedMs - t.stats.distractionMs)) / t.stats.trackedMs) : null;
  return <>
    {timeline.loading && <p className="lib-hint" role="status">Loading…</p>}
    {timeline.error && <p className="lib-bad" role="alert">{timeline.error}</p>}
    {t && !!t.cards.length && <div className="lib-card lib-glance"><div className="lib-grow"><b>Day at a glance</b><p className="lib-figs">{focus !== null && <span><b>{focus}%</b> focus</span>}<span><b>{duration(t.stats.trackedMs)}</b> tracked</span></p></div></div>}
    {t && (t.cards.length ? <div className="lib-plain" data-testid="logbook-timeline">{t.cards.map(c => <div className="lib-row lib-logcard" key={c.id}>
      <IcoTile icon={(Object.hasOwn(ICONS, c.category.toLowerCase()) ? ICONS[c.category.toLowerCase()] : "clock")} />
      <span className="lib-grow"><b>{c.title}</b><small>{clock(c.startMs)}–{clock(c.endMs)}</small><span className="lib-sum">{c.summary}</span>
        {!!c.distractions.length && <small className="lib-dist"><b>Distractions</b> {c.distractions.map(d => d.title).join(", ")}</small>}</span>
    </div>)}</div>
      : <EmptyLine icon={<EmptyIcon name="clock" />}><b>Nothing on the timeline yet.</b><br />Logbook is taking pictures; cards appear after the first look.</EmptyLine>)}
    <Standup engine={engine} day={day} />
    <Ask engine={engine} day={day} />
  </>;
}

function Standup({ engine, day }: { engine: WindowEngine; day: string }) {
  const op = useOperation(engine);
  const [text, setText] = useState<string | null>(null);
  return <Section title="Daily standup" hint="Turn today's timeline into a standup update you can paste. It works from your screen timeline, not from Trunks' tasks." testid="standup">
    <button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run<unknown>("logbook.standup", { day, ...(text !== null ? { refresh: true } : {}) }, r => setText(str(rec(r).text)))}>{text === null ? "Make it" : "Make it again"}</button>
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
    {text !== null && <pre className="lib-pre">{text}</pre>}
  </Section>;
}

function Ask({ engine, day }: { engine: WindowEngine; day: string }) {
  const op = useOperation(engine);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const ask = (e: FormEvent) => { e.preventDefault(); if (question.trim()) void op.run<unknown>("logbook.ask", { day, question: question.trim() }, r => setAnswer(str(rec(r).answer))); };
  return <Section title="Ask your day" testid="ask-day">
    <form className="lib-form" onSubmit={ask}><input className="inp" aria-label="Ask your day" placeholder="When did I review the pull request?" value={question} onChange={e => setQuestion(e.target.value)} /><button type="submit" className="btn" disabled={op.busy || !question.trim()}>Ask</button></form>
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
    {answer !== null && <p className="lib-about">{answer}</p>}
  </Section>;
}
