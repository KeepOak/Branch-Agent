// The sections under the schedule list (§4.6.3.1, preview p30-sched / 94-g4p): Ideas, Standing orders and loops,
// [A] Running on its own, more, Reminders and [A] How they're doing. A part with no engine store is drawn
// greyed with its reason; nothing here shows sample rows.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
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

export const NEEDS = {
  orders: "Needs the engine’s standing-orders store.",
  reminders: "Needs the engine’s reminders store.",
  ready: "Needs the engine’s unattended-run check.",
  days: "Needs the engine’s calendar of days off.",
  watches: "Needs the engine’s watches store.",
  leads: "Needs the engine’s lists store.",
  forecasts: "Needs the engine’s forecasts store.",
};

export function StandingOrders() {
  return <Section title="Standing orders and loops">
    <ToolRow icon="target" title="Standing orders" sub="Rules a Trunk keeps on its own, and loops that repeat a command until you stop them." button="Add" reason={NEEDS.orders} />
  </Section>;
}

export function Reminders() {
  return <Section title="Reminders" hint="Reminders, alarms and to-dos. They go only where you said, and ask again if you don’t answer.">
    <ToolRow icon="clock" title="Reminders, alarms and to-dos" sub="Snooze or mark done from here, or from the chat it reached you in." button="Add" reason={NEEDS.reminders} />
  </Section>;
}

export function RunningMore({ paused, canWrite, busy, setPaused }: { paused: boolean; canWrite: boolean; busy: boolean; setPaused: (paused: boolean) => void }) {
  return <Section title="Running on its own, more">
    <ToolRow icon="pause" title="Pause every automation" sub="One switch for every schedule and trigger. Each switch keeps its setting." button={paused ? "Resume all" : "Pause all"} reason={canWrite ? undefined : "Needs an owner"} run={() => setPaused(!paused)} busy={busy} />
    <ToolRow icon="check" title="Ready to run alone?" sub="Checks what an automation needs before it runs unattended, and keeps a ledger of what it decided alone." button="Check" reason={NEEDS.ready} />
    <ToolRow icon="clock" title="Days off and holidays" sub="Schedules skip or move around the days you mark." button="See the calendar" reason={NEEDS.days} />
    <ToolRow icon="globe" title="Watches" sub="A Trunk keeps an eye on a page, a price or a folder and speaks up when it changes." button="See them" reason={NEEDS.watches} />
    <ToolRow icon="form" title="Leads" sub="A list a Trunk keeps up to date and can export." button="Open the list" reason={NEEDS.leads} />
    <ToolRow icon="pulse" title="Forecasts" sub="A figure it projects from what it already knows, with how sure it is." button="See one" reason={NEEDS.forecasts} />
  </Section>;
}

const dur = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`;
/** [A] How they're doing: the last 12 recorded runs of each automation and how long they take. */
export function HowTheyreDoing({ jobs, runs }: { jobs: Row[]; runs: Map<string, { entries: Row[] }> }) {
  const list = jobs.map(j => ({ j, r: (runs.get(str(j.id))?.entries ?? []).slice(0, 12) })).filter(x => x.r.length);
  if (!list.length) return null;
  return <Section title="How they’re doing" hint="The last 12 runs of each and how long they take.">
    {list.map(({ j, r }) => {
      const ok = r.filter(x => x.status === "ok").length, times = r.map(x => Number(x.durationMs) || 0).filter(Boolean);
      const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0, err = r.find(x => x.status === "error");
      return <div className="au-tool" key={str(j.id)}><span className="au-grow"><b>{jobName(j)}</b><small>{ok} of {r.length} worked{avg ? ` · about ${dur(avg)} a run` : ""}{err && r[0] === err && str(err.error) ? ` · last error: ${str(err.error)}` : ""}</small></span></div>;
    })}
  </Section>;
}

export function PausedBanner({ canWrite, busy, resume }: { canWrite: boolean; busy: boolean; resume: () => void }) {
  return <div className="au-banner" role="status"><i className="au-dot warn" /><span className="au-grow"><b>Every automation is paused</b><small>Nothing runs on a schedule until you resume. Each switch keeps its setting.</small></span><button type="button" className="btn pri sm" disabled={!canWrite || busy} title={canWrite ? undefined : "Needs an owner"} onClick={resume}>Resume all</button></div>;
}
