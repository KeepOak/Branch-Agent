// Automations › Triggers (§4.6.3.3, preview p40-auto-other + 94-g4p). Rows are the engine's automations with
// a check first (cron trigger script) or a process event schedule (on-exit / stream), with the check readout
// from their state. [A] Hooks lists hooks.status and switches hooks.internal.entries.<key>.enabled.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows, type Level } from "../../places-nav/level";
import { runOutcome, useAct } from "./act";
import { loadScheduled, patchConfig } from "./data";
import { Glyph } from "./glyphs";
import { isTrigger, jobName } from "./model";
import { Field, SwitchRow, type Trunk } from "./Proposal";
import { JobRow, rowMenuItems, trunkNameOf } from "./Rows";
import { canAdmin, saveDraft } from "./Scheduled";
import { Section, ToolRow } from "./Sections";
import { Sheet } from "./Sheet";
import { RemoveDialog } from "./Dialogs";
import { errorText, rec, rows, str, usePlaceData, type Row } from "./runtime";

export const TRIGGER_NEEDS = {
  words: "Needs the engine to write the check from your words; at Technical you can write the check yourself.",
  tellApp: "Needs the engine’s web addresses for task events.",
  afterAnswer: "Needs the engine’s after-answer hook setup.",
  gmail: "Needs the engine’s Gmail watch setup method.",
  address: "Needs the engine’s method to make a web address and its key.",
  feeds: "Needs the engine’s feeds store.",
  page: "Needs the engine’s public pages.",
  packs: "Needs the plugin installer’s hook packs.",
};

type Card = { task: string; agentId: string; every: string; script: string; once: boolean };
/** cron.add params for a trigger card: a recurring check (trigger.script) that starts the task only when it finds something. */
export function triggerParams(c: Card): Row {
  const n = Number(c.every);
  if (!c.task.trim()) throw new Error("Say what it does.");
  if (!Number.isFinite(n) || n * 60 < 30) throw new Error("Checks must be at least 30 seconds apart.");
  if (!c.script.trim()) throw new Error("Write the check.");
  return { name: c.task.trim().slice(0, 48), schedule: { kind: "every", everyMs: Math.round(n * 60_000) }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: c.task.trim() }, trigger: { script: c.script, ...(c.once ? { once: true } : {}) }, ...(c.agentId ? { agentId: c.agentId } : {}), enabled: true };
}

function TriggerCard({ card, set, level, trunks, busy, canWrite, error, onCancel, onConfirm }: { card: Card; set: (c: Partial<Card>) => void; level: Level; trunks: Trunk[]; busy: boolean; canWrite: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const tech = shows(level, "technical");
  const reason = !canWrite ? "Needs an owner" : tech ? undefined : TRIGGER_NEEDS.words;
  return <section className="au-prop" aria-label="Confirm trigger">
    <div className="au-prop-h"><Glyph name="pulse" /><b>Here’s the trigger Branch understood</b><span className="au-pill"><i />Not saved yet</span></div>
    <Field label="It does"><input className="inp" aria-label="It does" value={card.task} onChange={e => set({ task: e.target.value })} /></Field>
    {trunks.length > 0 && <Field label="Who does it"><select className="inp" aria-label="Who does it" value={card.agentId} onChange={e => set({ agentId: e.target.value })}>{trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
    <p className="au-hint">A quick check runs on a timer and starts the Trunk only when it finds something.</p>
    <Field label="Check every"><span className="au-inline"><input className="inp au-num" type="number" min="0.5" step="any" aria-label="Check every" value={card.every} onChange={e => set({ every: e.target.value })} /><span>minutes</span></span></Field>
    <SwitchRow title="Stop after the first time it fires" on={card.once} change={once => set({ once })} />
    {tech && <Field label="The check" hint="30 seconds, 5 tool calls and 16 KB of saved state per check."><textarea className="inp au-text" aria-label="The check" value={card.script} onChange={e => set({ script: e.target.value })} /></Field>}
    {error && <p className="au-error" role="alert">{error}</p>}
    <div className="au-actions"><button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button><button type="button" className="btn pri sm" title={shownWhy(reason)} disabled={busy || Boolean(reason)} onClick={onConfirm}>Confirm the trigger</button></div>
  </section>;
}

const SOURCE: Record<string, string> = { "branch-bundled": "Built in", "branch-managed": "Installed", "branch-workspace": "In this Trunk’s folder" };
export function hookPill(h: Row): string {
  const missing = rec(h.missing), need = ["bins", "anyBins", "env", "config", "os"].flatMap(k => (Array.isArray(missing[k]) ? missing[k].map(String) : []));
  if (!Array.isArray(h.events) || !h.events.length) return "No events";
  if (h.requirementsSatisfied === false) return `Needs ${need[0] ?? "setup"}`;
  return h.enabledByConfig === true ? "Ready" : "Off";
}
export const hookSwitchPatch = (key: string, on: boolean): Row => ({ hooks: { internal: { ...(on ? { enabled: true } : {}), entries: { [key]: { enabled: on } } } } });

const loadHooks = async (engine: WindowEngine) => rows(rec(await engine.request("hooks.status", {})).hooks);
function HooksDialog({ engine, canWrite, onClose }: { engine: WindowEngine; canWrite: boolean; onClose: () => void }) {
  const state = usePlaceData(engine, loadHooks), { busy, run } = useAct(state.refresh);
  const [onlyReady, setOnlyReady] = useState(false);
  const hooks = state.data ?? [], ready = hooks.filter(h => hookPill(h) === "Ready").length;
  return <Dialog wide title="Hooks" onClose={onClose} footer={<><button type="button" className="btn sm" disabled title={shownWhy(TRIGGER_NEEDS.packs)}>Add a hook pack…</button></>}>
    <p className="au-hint">Small programs that run when something happens in Branch: a command, a message, a conversation starting or being shortened, the Gateway starting. They run with full access to the Gateway’s computer.</p>
    {state.error && <p className="au-error" role="alert">{state.error}</p>}
    {hooks.length > 0 && <SwitchRow title={`${ready} of ${hooks.length} ready`} sub="Only ready ones" on={onlyReady} change={setOnlyReady} />}
    {!state.loading && !hooks.length && !state.error && <p className="au-hint">No hooks on this computer yet.</p>}
    {hooks.filter(h => !onlyReady || hookPill(h) === "Ready").map(h => {
      const key = str(h.hookKey) || str(h.name), plugin = h.managedByPlugin === true, pill = hookPill(h);
      return <div className="au-tool" key={key}><span className="au-tile"><Glyph name="term" /></span><span className="au-grow"><b>{str(h.name)}</b><small>{str(h.description)}</small><small>{plugin ? `From ${str(h.pluginId) || "a plugin"}` : SOURCE[str(h.source)] ?? str(h.source)}</small></span><span className={pill === "Ready" ? "au-pill ok" : pill.startsWith("Needs") ? "au-pill warn" : "au-pill"}><i />{pill}</span>
        {plugin ? <small className="au-hint">Turn it on or off with its plugin</small> : <button type="button" role="switch" className="switch" aria-checked={h.enabledByConfig === true} aria-label={`${str(h.name)} on or off`} disabled={!canWrite || busy} title={canWrite ? undefined : "Needs an owner"} onClick={() => void run(() => patchConfig(engine, hookSwitchPatch(key, h.enabledByConfig !== true)), h.enabledByConfig ? `Turned off ${str(h.name)}.` : `Turned on ${str(h.name)}.`)} />}</div>;
    })}
  </Dialog>;
}

function Hooks({ engine, level, canWrite }: { engine: WindowEngine; level: Level; canWrite: boolean }) {
  const [open, setOpen] = useState(false), { run } = useAct(async () => undefined);
  return <Section title="Hooks">
    <ToolRow icon="globe" title="Tell another app when something happens" sub="An address Branch calls when a task finishes, needs you, or fails." button="Add one" reason={TRIGGER_NEEDS.tellApp} />
    <ToolRow icon="term" title="Before and after each step" sub="A script of yours that runs when a task starts, before a tool runs, or when it ends." button="See hooks" run={() => setOpen(true)} />
    <ToolRow icon="chat" title="After each answer" sub="Runs something every time a Trunk finishes a reply, such as copying it to your notes." button="Set one up" reason={TRIGGER_NEEDS.afterAnswer} />
    <ToolRow icon="mail" title="New Gmail mail, the moment it arrives" sub="A Trunk starts as soon as a new email lands, without checking on a timer." button="Set up" reason={TRIGGER_NEEDS.gmail} />
    <ToolRow icon="globe" title="Start work from a web address" sub="Another app calls an address and a Trunk starts." button="Add one" reason={TRIGGER_NEEDS.address} />
    {shows(level, "technical") && <div className="au-tool"><span className="au-grow"><small>The hooks section of the settings file.</small></span><button type="button" className="btn ghost sm" disabled={!canWrite} title={canWrite ? undefined : "Needs an owner"} onClick={() => void run(async () => { const r = rec(await engine.request("config.openFile", {})); if (r.ok !== true) throw new Error(str(r.error) || "The settings file couldn’t be opened."); return r; }, "Opened the settings file on the Gateway’s computer.")}>Edit as text</button></div>}
    {open && <HooksDialog engine={engine} canWrite={canWrite} onClose={() => setOpen(false)} />}
  </Section>;
}

type Open = { kind: "menu"; job: Row; at: MenuAnchor } | { kind: "sheet" | "remove"; job: Row } | null;
export function TriggersTab({ engine, level, openConversation }: { engine: WindowEngine; level: Level; openConversation: (key: string) => void }) {
  const state = usePlaceData(engine, loadScheduled), { busy, run } = useAct(state.refresh);
  const [words, setWords] = useState(""), [card, setCard] = useState<Card | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<Open>(null);
  const write = canAdmin(engine), data = state.data, adv = shows(level, "advanced");
  const jobs = (data?.jobs ?? []).filter(isTrigger);
  const act = (method: string, params: Row, message: string) => run(() => engine.request(method, params), message);
  const confirm = () => { if (!card) return; let params: Row; try { setError(""); params = triggerParams(card); } catch (e) { setError(errorText(e)); return; } void run(() => engine.request("cron.add", params), "Trigger saved.").then(ok => ok && setCard(null)); };
  const menu = open?.kind === "menu" ? rowMenuItems(open.job, level, write, {
    runNow: (job, mode) => void run(async () => { const r = rec(await engine.request("cron.run", { id: job.id, mode })); runOutcome(r); return r; }, `Running ${jobName(job)}.`),
    change: job => setOpen({ kind: "sheet", job }), duplicate: job => setOpen({ kind: "sheet", job }), sends: job => setOpen({ kind: "sheet", job }), fails: job => setOpen({ kind: "sheet", job }), remove: job => setOpen({ kind: "remove", job }),
  }).filter(i => !("label" in i) || !["Duplicate", "Change where it sends…", "When it fails…"].includes(i.label)) : [];
  return <div className="au-tab">
    <p className="au-hint">Work that starts when something happens.</p>
    <form className="au-describe" onSubmit={e => { e.preventDefault(); if (words.trim()) { setError(""); setCard({ task: words.trim(), agentId: data?.defaultId || "", every: "30", script: "", once: false }); setWords(""); } else e.currentTarget.querySelector("input")?.focus(); }}>
      <input className="inp" aria-label="Describe a new trigger" placeholder={"Describe it: “when a PDF lands in Downloads, summarise it”"} value={words} disabled={!write} title={write ? undefined : "Needs an owner"} onChange={e => setWords(e.target.value)} />
      <button type="submit" className="btn pri" disabled={!write}>Add</button>
    </form>
    {card && <TriggerCard card={card} set={p => setCard(c => c && { ...c, ...p })} level={level} trunks={data?.trunks ?? []} busy={busy} canWrite={write} error={error} onCancel={() => setCard(null)} onConfirm={confirm} />}
    {state.error && <p className="au-error" role="alert">{state.error}</p>}
    {data && (jobs.length ? <div className="au-list">{jobs.map(job => <JobRow key={str(job.id)} job={job} trunk={trunkNameOf(data.trunks, job.agentId, data.defaultId)} runs={data.runs.get(str(job.id))?.entries ?? []} total={data.runs.get(str(job.id))?.total} level={level} canWrite={write} busy={busy} checkReadout actions={{ open: j => setOpen({ kind: "sheet", job: j }), toggle: j => void act("cron.update", { id: j.id, ...(j.configRevision ? { expectedConfigRevision: j.configRevision } : {}), patch: { enabled: j.enabled !== true } }, j.enabled ? `Paused ${jobName(j)}.` : `${jobName(j)} is on.`), menu: (j, at) => setOpen({ kind: "menu", job: j, at }) }} />)}</div>
      : <EmptyLine icon={<Glyph name="pulse" size={22} />}>Nothing starts on its own yet. Describe what should start it above.</EmptyLine>)}
    {adv && <Hooks engine={engine} level={level} canWrite={write} />}
    {adv && <Section title="Feeds into a chat" hint="Each new item is posted once, never repeated."><ToolRow icon="rss" title="An RSS, Reddit or YouTube address" sub="New items go to a conversation you pick." button="Add" reason={TRIGGER_NEEDS.feeds} /></Section>}
    {adv && <Section title="A page anyone can fill in"><ToolRow icon="form" title="A page anyone can fill in" sub="A form or a small chat page of its own; whoever fills it in starts the automation and sees its answer." button="Make one" reason={TRIGGER_NEEDS.page} /></Section>}
    {open?.kind === "menu" && <Menu at={open.at} label={`More for ${jobName(open.job)}`} items={menu} onClose={() => setOpen(null)} />}
    {open?.kind === "remove" && <RemoveDialog job={open.job} act={act} busy={busy} onClose={() => setOpen(null)} />}
    {open?.kind === "sheet" && <Sheet engine={engine} job={open.job} level={level} trunks={data?.trunks ?? []} models={[]} canWrite={write} busy={busy} onClose={() => setOpen(null)} openConversation={openConversation} save={d => run(() => saveDraft(engine, d), r => str(r.message))} />}
  </div>;
}
