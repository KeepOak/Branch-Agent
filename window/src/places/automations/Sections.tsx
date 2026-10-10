// The sections under the schedule list (§4.6.3.1, preview p30-sched / 94-g4p): Ideas, Pause everything and How they're
// doing. Features with no engine store yet (standing orders, reminders, watches, leads, forecasts) are not drawn; they
// come back with their engine store.
import { useState, type ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import { Glyph, type GlyphName } from "./glyphs";
import { jobName } from "./model";
import { str, type Row } from "./runtime";

export const IDEAS: [string, string, string][] = [
  ["Money", "Receipts into folders", "When a receipt lands in email, file it by the month it was paid."],
  ["Money", "Subscription watch", "Tell me when a subscription price goes up."],
  ["Money", "Bill reminders", "A nudge three days before each bill is due."],
  ["Mornings", "Morning brief", "Bring together today’s calendar and news."],
  ["Mornings", "Inbox triage", "Sort new email and flag what needs an answer."],
  ["Home", "Tidy Downloads", "Sort new downloads into useful folders."],
  ["Home", "Backup check", "Check whether the latest backup completed."],
  ["Home", "Photo clean-up", "Find photos that may need tidying and ask before deleting."],
  ["Research", "Price tracker", "Check the price of something I am watching."],
  ["Research", "News on a topic", "Bring me new reporting on a topic I choose."],
  ["Research", "Page change alert", "Check a page for meaningful changes."],
  ["Work", "Meeting notes", "Prepare notes for the meetings on my calendar."],
  ["Work", "Weekly report", "Summarize what happened in my work this week."],
];

export function Section({ title, aside, hint, children }: { title: string; aside?: ReactNode; hint?: string; children: ReactNode }) {
  return <section className="au-sec"><div className="au-sec-h"><h2>{title}</h2>{aside}</div>{hint && <p className="au-hint">{hint}</p>}{children}</section>;
}

/** A row whose button runs an engine method, or is greyed with the reason when the engine has none. */
export function ToolRow({ icon, title, sub, button, reason, run, busy }: { icon: GlyphName; title: string; sub: string; button: string; reason?: string; run?: () => void; busy?: boolean }) {
  return <div className="au-tool">
    <span className="au-tile"><Glyph name={icon} /></span>
    <span className="au-grow"><b>{title}</b><small>{sub}</small></span>
    <button type="button" className="btn sm" disabled={Boolean(reason) || !run || busy} title={shownWhy(reason)} onClick={run}>{button}</button>
  </div>;
}

export function Ideas({ pick, canWrite }: { pick: (title: string, message: string) => void; canWrite: boolean }) {
  const [all, setAll] = useState(false);
  return <Section title="Ideas" aside={<button type="button" className="au-link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `See all ${IDEAS.length}`}</button>}>
    <div className="au-ideas">{IDEAS.slice(0, all ? IDEAS.length : 3).map(([group, title, message]) => <button type="button" className="au-idea" key={title} disabled={!canWrite} title={canWrite ? undefined : "Needs an owner"} onClick={() => pick(title, message)}><small>{group}</small><b>{title}</b><span>{message}</span></button>)}</div>
  </Section>;
}

/** One switch for every schedule and trigger. Shown while nothing is paused; the paused banner offers Resume all. */
export function PauseEverything({ canWrite, busy, setPaused }: { canWrite: boolean; busy: boolean; setPaused: (paused: boolean) => void }) {
  return <Section title="Pause everything">
    <ToolRow icon="pause" title="Pause every automation" sub="Each switch keeps its setting. Resume brings them all back." button="Pause all" reason={canWrite ? undefined : "Needs an owner"} run={() => setPaused(true)} busy={busy} />
  </Section>;
}

const dur = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`;
/** How they're doing: the last 12 recorded runs of each automation and how long they take. One click away, not shown by default. */
export function HowTheyreDoing({ jobs, runs }: { jobs: Row[]; runs: Map<string, { entries: Row[] }> }) {
  const list = jobs.map(j => ({ j, r: (runs.get(str(j.id))?.entries ?? []).slice(0, 12) })).filter(x => x.r.length);
  if (!list.length) return null;
  return <details className="au-more">
    <summary>How they’re doing</summary>
    <p className="au-hint">The last 12 runs of each and how long they take.</p>
    {list.map(({ j, r }) => {
      const ok = r.filter(x => x.status === "ok").length, times = r.map(x => Number(x.durationMs) || 0).filter(Boolean);
      const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0, err = r.find(x => x.status === "error");
      return <div className="au-tool" key={str(j.id)}><span className="au-grow"><b>{jobName(j)}</b><small>{ok} of {r.length} worked{avg ? ` · about ${dur(avg)} a run` : ""}{err && r[0] === err && str(err.error) ? ` · last error: ${str(err.error)}` : ""}</small></span></div>;
    })}
  </details>;
}

export function PausedBanner({ canWrite, busy, resume }: { canWrite: boolean; busy: boolean; resume: () => void }) {
  return <div className="au-banner" role="status"><i className="au-dot warn" /><span className="au-grow"><b>Every automation is paused</b><small>Nothing runs on a schedule until you resume. Each switch keeps its setting.</small></span><button type="button" className="btn pri sm" disabled={!canWrite || busy} title={canWrite ? undefined : "Needs an owner"} onClick={resume}>Resume all</button></div>;
}
