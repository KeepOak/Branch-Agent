// The proposal card (§4.6.3.1, preview 41-placesap p35-prop): Regular shows It does, Repeats, At, Who does it
// and Sends to; Advanced adds name, note, how it runs, Every…, model, time zone, limits and switches; Technical
// adds routing, the spread and an editable cron line. Every field maps to a cron.add / cron.update field.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { shownWhy } from "../../shell/shown-why";
import { Segmented, Switch } from "../../shell/Popover";
import { shows, type Level } from "../../places-nav/level";
import { connectedApps, type ChannelsStatus } from "../settings/set1/chatapps-data";
import { Glyph } from "./glyphs";
import { cronLine, customWords, DAYS, firstRun, formWords, REPEAT_NAMES, when, type Repeat, type ScheduleForm } from "./model";
import type { Draft, SendsTo } from "./draft";
import { rec } from "./runtime";

export type Trunk = { id: string; name: string };
type Props = {
  draft: Draft; change: (patch: Partial<Draft>) => void; level: Level; trunks: Trunk[]; models: string[];
  busy: boolean; canWrite: boolean; error: string; onCancel: () => void; onConfirm: (runNow: boolean) => void; inSheet?: boolean;
  /** Live chat apps (channels.status). Sheet and Scheduled pass the engine; tests may pass the snapshot. */
  engine?: WindowEngine; channelsStatus?: ChannelsStatus;
};

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Lisbon", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC"];
export const CHATS_REASON = "Connect a chat app in Settings › Chat apps first.";

type ChatChoice = { id: string; accountId: string; label: string };

/** Connected chat-app accounts for the Sends to picker (channels.status, same read as Settings › Chat apps). */
export function chatAppChoices(status: ChannelsStatus | undefined, technical: boolean): ChatChoice[] {
  return connectedApps(status).flatMap(app => {
    const accounts = app.accounts.length ? app.accounts : [{ accountId: "default" as const }];
    return accounts.map(a => {
      const named = (a.name ?? "").trim();
      const label = technical ? `${app.name} · ${a.accountId}` : named && named !== app.name ? `${app.name} · ${named}` : app.name;
      return { id: `${app.id}:${a.accountId}`, accountId: a.accountId, label };
    });
  });
}

function useChannelsStatus(engine?: WindowEngine, passed?: ChannelsStatus): ChannelsStatus | undefined {
  const [loaded, setLoaded] = useState<ChannelsStatus | undefined>(undefined);
  useEffect(() => {
    if (passed || !engine) return;
    let live = true;
    engine.request("channels.status", { probe: false }).then(
      value => { if (live) setLoaded(rec(value) as ChannelsStatus); },
      () => { if (live) setLoaded({}); },
    );
    return () => { live = false; };
  }, [engine, passed]);
  return passed ?? loaded;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="au-field"><span className="au-flabel">{label}</span>{children}{hint ? <small className="au-hint">{hint}</small> : null}</label>;
}
export function SwitchRow({ title, sub, on, change, disabled }: { title: string; sub?: string; on: boolean; change: (v: boolean) => void; disabled?: string }) {
  return <div className="au-swrow" title={shownWhy(disabled)}><span><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>{disabled ? <button type="button" role="switch" aria-checked={on} aria-label={title} className="switch" disabled /> : <Switch label={title} on={on} onChange={change} />}</div>;
}

function RepeatsField({ form, set, level }: { form: ScheduleForm; set: (f: Partial<ScheduleForm>) => void; level: Level }) {
  const ids: Repeat[] = ["daily", "weekdays", "weekends", "weekly", "monthly", ...(shows(level, "advanced") ? ["every" as Repeat] : []), "once"];
  const options = ids.map(id => ({ id, name: REPEAT_NAMES[id as Exclude<Repeat, "custom">] }));
  const custom = form.repeat === "custom";
  return <Field label="Repeats">{custom && <p className="au-hint">{customWords(form.expr)}</p>}{(!custom || shows(level, "technical")) && <div className={custom ? "au-noval" : undefined}><Segmented label="Repeats" value={custom ? ("" as Repeat) : form.repeat} options={options} onChange={repeat => set({ repeat })} testid="au-repeats" /></div>}</Field>;
}

function WhenFields({ form, set }: { form: ScheduleForm; set: (f: Partial<ScheduleForm>) => void }) {
  if (form.repeat === "once") return <Field label="At"><input className="inp" type="datetime-local" aria-label="On this date and time" value={form.at} onChange={e => set({ at: e.target.value })} /></Field>;
  if (form.repeat === "every") return <Field label="Every"><span className="au-inline"><input className="inp au-num" type="number" min="0" step="any" aria-label="Every how many" value={form.everyN} onChange={e => set({ everyN: e.target.value })} /><select className="inp" aria-label="Unit" value={form.everyUnit} onChange={e => set({ everyUnit: e.target.value as ScheduleForm["everyUnit"] })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select></span></Field>;
  if (form.repeat === "custom") return null;
  return <>
    <Field label="At"><input className="inp" type="time" aria-label="At" value={form.time} onChange={e => set({ time: e.target.value })} /></Field>
    {form.repeat === "weekly" && <Field label="On"><select className="inp" aria-label="On" value={form.weekday} onChange={e => set({ weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>}
    {form.repeat === "monthly" && <Field label="On day"><input className="inp au-num" type="number" min="1" max="28" aria-label="On day" value={form.monthDay} onChange={e => set({ monthDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} /></Field>}
  </>;
}

function ZoneField({ form, set, level }: { form: ScheduleForm; set: (f: Partial<ScheduleForm>) => void; level: Level }) {
  if (!shows(level, "advanced") || form.repeat === "once" || form.repeat === "every") return null;
  return <Field label="Time zone"><select className="inp" aria-label="Time zone" value={form.tz} onChange={e => set({ tz: e.target.value })}><option value="">This computer’s time zone</option>{[...new Set([...(form.tz ? [form.tz] : []), ...ZONES])].map(z => <option key={z} value={z}>{z}</option>)}</select></Field>;
}

function WhoField({ draft, change, trunks }: { draft: Draft; change: Props["change"]; trunks: Trunk[] }) {
  if (!trunks.length) return null;
  if (trunks.length <= 5) return <Field label="Who does it"><Segmented label="Who does it" value={draft.agentId} options={trunks.map(t => ({ id: t.id, name: t.name }))} onChange={agentId => change({ agentId })} /></Field>;
  return <Field label="Who does it"><select className="inp" aria-label="Who does it" value={draft.agentId} onChange={e => change({ agentId: e.target.value })}>{trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>;
}

export function SendsToFields({ draft, change, level, trunk, engine, channelsStatus }: { draft: Draft; change: Props["change"]; level: Level; trunk: string; engine?: WindowEngine; channelsStatus?: ChannelsStatus }) {
  const status = useChannelsStatus(engine, channelsStatus);
  if (draft.how === "note") return null;
  const adv = shows(level, "advanced"), tech = shows(level, "technical");
  const choices = chatAppChoices(status, tech);
  const chatsOn = choices.length > 0;
  const picked = choices.find(c => c.id === draft.account || c.accountId === draft.account)?.id ?? "";
  const pickChats = (sendsTo: SendsTo) => {
    if (sendsTo !== "chats") return change({ sendsTo });
    change({ sendsTo, ...(draft.account.trim() ? {} : { account: choices[0]?.accountId ?? "" }) });
  };
  return <>
    <Field label="Sends to"><select className="inp" aria-label="Sends to" value={draft.sendsTo} onChange={e => pickChats(e.target.value as SendsTo)}>
      {draft.mode === "edit" && <option value="keep">Where it sends now</option>}
      <option value="conversation">{trunk}’s conversation</option>
      {chatsOn ? <option value="chats">Chats in your chat apps</option> : <option value="chats" disabled title={shownWhy(CHATS_REASON)}>Chats in your chat apps</option>}
      {adv && <option value="nowhere">Nowhere: keep it in History</option>}
      {adv && <option value="webhook">Another app (web address)</option>}
    </select></Field>
    {draft.sendsTo === "chats" && chatsOn && <Field label="Chat app"><select className="inp" aria-label="Chat app" value={picked} onChange={e => change({ account: choices.find(c => c.id === e.target.value)?.accountId ?? e.target.value })}>{choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>}
    {draft.sendsTo === "webhook" && <Field label="Web address" hint="Each result is posted to this address."><input className="inp" aria-label="Web address" placeholder="https://example.com/hook" value={draft.webhook} onChange={e => change({ webhook: e.target.value })} /></Field>}
    {draft.sendsTo === "chats" && !tech && <Field label="Recipient" hint="Who should get each result."><input className="inp" aria-label="Recipient" value={draft.recipient} onChange={e => change({ recipient: e.target.value })} /></Field>}
    {tech && (draft.sendsTo === "conversation" || draft.sendsTo === "chats") && <Field label="Recipient" hint="A phone number or chat ID, to send somewhere other than the chat above."><input className="inp au-mono" aria-label="Recipient" value={draft.recipient} onChange={e => change({ recipient: e.target.value })} /></Field>}
    {tech && draft.sendsTo !== "nowhere" && draft.sendsTo !== "keep" && <Field label="Chat-app account" hint="For an app with several accounts."><input className="inp" aria-label="Chat-app account" value={draft.account} onChange={e => change({ account: e.target.value })} /></Field>}
    {adv && draft.sendsTo !== "nowhere" && draft.sendsTo !== "keep" && <SwitchRow title="Count it as done even if sending fails" sub="The task still counts as done when its result couldn’t be sent. Failure alerts for it stay quiet unless it has its own (When it fails…)." on={draft.bestEffort} change={bestEffort => change({ bestEffort })} />}
  </>;
}

function TaskFields({ draft, change, level, trunk }: { draft: Draft; change: Props["change"]; level: Level; trunk: string }) {
  const adv = shows(level, "advanced"), tech = shows(level, "technical");
  if (draft.payloadKind === "command" || draft.payloadKind === "script") {
    const o = (draft.original?.payload ?? {}) as Record<string, unknown>;
    const text = draft.payloadKind === "script" ? String(o.script ?? "") : Array.isArray(o.argv) ? o.argv.join(" ") : "";
    return <Field label="It does" hint="Made outside Branch. It stays as it is when you save other changes.">{tech ? <pre className="au-code">{text}</pre> : <p className="au-mono">{draft.payloadKind === "script" ? "Runs a script" : "Runs a command"}</p>}</Field>;
  }
  return <>
    {adv && <div className="au-grid"><Field label="Name"><input className="inp" aria-label="Name" value={draft.name} onChange={e => change({ name: e.target.value })} /></Field><Field label="Note"><input className="inp" aria-label="Note" placeholder="Anything you want to remember about it" value={draft.note} onChange={e => change({ note: e.target.value })} /></Field></div>}
    <Field label={draft.how === "note" ? "The note" : "It does"}><input className="inp" aria-label={draft.how === "note" ? "The note" : "It does"} value={draft.message} onChange={e => change({ message: e.target.value, ...(adv || draft.mode === "edit" ? {} : { name: e.target.value.slice(0, 48) }) })} /></Field>
    {adv && <Field label="How it runs" hint={draft.how === "note" ? `The words land in ${trunk}’s conversation, good for reminders; it reads them at its next check-in or at once.` : `${trunk} does the task on its own and sends the result.`}><Segmented label="How it runs" value={draft.how} options={[{ id: "task", name: "As its own task" }, { id: "note", name: `As a note to ${trunk}` }]} onChange={how => change({ how })} /></Field>}
    {tech && draft.how === "note" && <Field label="When it’s read" hint={`Right away wakes ${trunk} now; the other waits for its next check-in.`}><Segmented label="When it’s read" value={draft.wake} options={[{ id: "now", name: "Right away" }, { id: "next-heartbeat", name: "At the next check-in" }]} onChange={wake => change({ wake })} /></Field>}
  </>;
}

function AdvancedRun({ draft, change, level, models, trunk }: { draft: Draft; change: Props["change"]; level: Level; models: string[]; trunk: string }) {
  if (!shows(level, "advanced") || draft.how === "note" || draft.payloadKind !== "agentTurn") return null;
  const tech = shows(level, "technical");
  return <>
    <Field label="Model" hint="A lighter model costs less for recurring jobs."><input className="inp" aria-label="Model" list="au-models" placeholder={`Same as ${trunk}`} value={draft.model} onChange={e => change({ model: e.target.value })} /><datalist id="au-models">{models.map(m => <option key={m} value={m} />)}</datalist></Field>
    {tech && <SwitchRow title="Always use the default Trunk" sub="Ignores the Trunk picked above." on={draft.clearAgent} change={clearAgent => change({ clearAgent })} />}
    {tech && <Field label="Conversation key" hint="Routes the result and the wake-up to one conversation."><input className="inp au-mono" aria-label="Conversation key" value={draft.sessionKey} onChange={e => change({ sessionKey: e.target.value })} /></Field>}
    {tech && <SwitchRow title="Start with a light briefing" sub="Leaves out the project’s files at the start of each run." on={draft.lightContext} change={lightContext => change({ lightContext })} />}
    <Field label="Stop a run after" hint="Leave empty to use the Gateway’s limit. 0 means no limit."><span className="au-inline"><input className="inp au-num" type="number" min="0" aria-label="Stop a run after" placeholder="Gateway’s limit" value={draft.timeout} onChange={e => change({ timeout: e.target.value })} /><span>seconds</span></span></Field>
  </>;
}

function Spread({ form, set }: { form: ScheduleForm; set: (f: Partial<ScheduleForm>) => void }) {
  if (form.repeat === "once" || form.repeat === "every") return null;
  return <>
    <SwitchRow title="Run on the exact minute" sub="Off: runs on the hour are spread over a few minutes so they don’t all start at once." on={form.exact} change={exact => set({ exact })} />
    {!form.exact && <Field label="Spread over"><span className="au-inline"><input className="inp au-num" type="number" min="0" aria-label="Spread over" value={form.spreadN} onChange={e => set({ spreadN: e.target.value })} /><select className="inp" aria-label="Spread unit" value={form.spreadUnit} onChange={e => set({ spreadUnit: e.target.value as "seconds" | "minutes" })}><option value="seconds">seconds</option><option value="minutes">minutes</option></select></span></Field>}
  </>;
}

function Footer({ draft, busy, canWrite, onCancel, onConfirm }: Pick<Props, "draft" | "busy" | "canWrite" | "onCancel" | "onConfirm">) {
  const why = canWrite ? undefined : "Needs an owner";
  if (draft.mode === "edit") return <div className="au-actions"><button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button><button type="button" className="btn pri sm" title={shownWhy(why)} disabled={busy || !canWrite} onClick={() => onConfirm(false)}>{busy ? "Saving…" : "Save changes"}</button></div>;
  return <div className="au-actions"><button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button><button type="button" className="btn sm" title={shownWhy(why)} disabled={busy || !canWrite} onClick={() => onConfirm(true)}>Confirm and run now</button><button type="button" className="btn pri sm" title={shownWhy(why)} disabled={busy || !canWrite} onClick={() => onConfirm(false)}>{busy ? "Saving…" : "Confirm the schedule"}</button></div>;
}

export function Proposal(props: Props) {
  const { draft, change, level, trunks, models, error, inSheet } = props;
  const trunk = trunks.find(t => t.id === draft.agentId)?.name || trunks[0]?.name || "the Trunk";
  const set = (f: Partial<ScheduleForm>) => change({ form: { ...draft.form, ...f } });
  const adv = shows(level, "advanced"), tech = shows(level, "technical");
  const first = firstRun(draft.form);
  return <section className={inSheet ? "au-prop in-sheet" : "au-prop"} aria-label={draft.mode === "edit" ? "Change the schedule" : "Confirm schedule"}>
    {!inSheet && <div className="au-prop-h"><Glyph name="clock" /><b>{draft.mode === "edit" ? "Change the schedule" : "Here’s the schedule Branch understood"}</b>{draft.mode !== "edit" && <span className="au-pill"><i />Not saved yet</span>}</div>}
    <TaskFields draft={draft} change={change} level={level} trunk={trunk} />
    <RepeatsField form={draft.form} set={set} level={level} />
    <div className="au-grid"><WhenFields form={draft.form} set={set} /><WhoField draft={draft} change={change} trunks={trunks} /></div>
    <AdvancedRun draft={draft} change={change} level={level} models={models} trunk={trunk} />
    <SendsToFields draft={draft} change={change} level={level} trunk={trunk} engine={props.engine} channelsStatus={props.channelsStatus} />
    <ZoneField form={draft.form} set={set} level={level} />
    {tech && <Spread form={draft.form} set={set} />}
    {adv && draft.mode !== "edit" && <SwitchRow title="Start it switched on" on={draft.enabled} change={enabled => change({ enabled })} />}
    {adv && draft.form.repeat === "once" && <SwitchRow title="Remove it after it runs" sub="For one-off reminders that tidy themselves away." on={draft.deleteAfterRun} change={deleteAfterRun => change({ deleteAfterRun })} />}
    <p className="au-sum"><b>{formWords(draft.form)}</b>{first ? ` · starts ${when(first)}` : ""}</p>
    {adv && draft.form.repeat !== "once" && draft.form.repeat !== "every" && (tech ? <Field label="Cron line"><input className="inp au-mono" aria-label="Cron line" placeholder="0 7 * * *" value={draft.form.repeat === "custom" ? draft.form.expr : cronLine(draft.form)} onChange={e => set({ repeat: "custom", expr: e.target.value })} /></Field> : <p className="au-mono au-cron" aria-label="Cron line">{cronLine(draft.form)}</p>)}
    {error && <p className="au-error" role="alert">{error}</p>}
    <Footer {...props} />
    {draft.mode !== "edit" && <p className="au-hint">It runs only after you confirm. Until then nothing is saved.</p>}
  </section>;
}
