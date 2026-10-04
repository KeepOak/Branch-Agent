// Automations › Scheduled (§4.6.3.1; preview 41-placesap p30-sched, p35-prop): describe-and-Add, the proposal
// card, the schedule rows with their menu and sheet, then Ideas and the sections below. All on cron.* methods.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows, type Level } from "../../places-nav/level";
import type { MenuAnchor } from "../../shell/Menu";
import { Menu } from "../../shell/Menu";
import { runOutcome, useAct } from "./act";
import { loadModels, loadScheduled, patchConfig, type Scheduled as Data } from "./data";
import { FailDialog, LeaveDialog, RemoveDialog, SendsDialog } from "./Dialogs";
import { notify } from "../../shell/notify";
import { addParams, draftFromIdea, draftFromJob, draftFromWords, editChanged, updateParams, type Draft } from "./draft";
import { Glyph } from "./glyphs";
import { copyName, firstRun, isTrigger, jobName, when } from "./model";
import { Proposal } from "./Proposal";
import { FIND0, FindBar, findJobs, JobRow, rowMenuItems, summaryLine, trunkNameOf, type Find } from "./Rows";
import { HowTheyreDoing, Ideas, PausedBanner, Reminders, RunningMore, StandingOrders } from "./Sections";
import { Sheet } from "./Sheet";
import { errorText, rec, str, usePlaceData, type Row } from "./runtime";

type Props = { engine: WindowEngine; level: Level; openConversation: (key: string) => void };
type Open = { kind: "menu"; job: Row; at: MenuAnchor } | { kind: "sheet" | "remove" | "sends" | "fails"; job: Row } | null;
export const canAdmin = (engine: WindowEngine) => engine.scopes.includes("operator.admin");

function useModels(engine: WindowEngine, level: Level, need: boolean): string[] {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => { if (need && shows(level, "advanced")) loadModels(engine).then(setModels, () => setModels([])); }, [engine, level, need]);
  return models;
}

/** Saves a card: cron.add, or cron.update with only what changed. Returns the toast words and the new id. */
export async function saveDraft(engine: WindowEngine, d: Draft): Promise<{ message: string; id: string }> {
  if (d.mode === "edit") {
    const r = rec(await engine.request("cron.update", updateParams(d)));
    const next = rec(rec(r.job ?? r).state).nextRunAtMs;
    return { message: typeof next === "number" ? `Saved. Next run: ${when(next)}.` : "Saved.", id: str(d.id) };
  }
  const r = rec(await engine.request("cron.add", addParams(d)));
  const job = rec(r.job ?? r), next = rec(job.state).nextRunAtMs ?? firstRun(d.form);
  return { message: `Scheduled. Next run: ${when(next)}.`, id: str(job.id) };
}

function List({ data, find, level, write, busy, actions, open }: { data: Data; find: Find; level: Level; write: boolean; busy: boolean; actions: Parameters<typeof JobRow>[0]["actions"]; open: Open }) {
  const [more, setMore] = useState(1);
  const all = data.jobs.filter(j => !isTrigger(j)), adv = shows(level, "advanced");
  const shown = adv ? findJobs(all, find) : all, page = shown.slice(0, more * 20);
  if (!all.length) return <EmptyLine icon={<Glyph name="clock" size={22} />}>Nothing runs on a schedule yet. Describe the work above, or start from an idea below.</EmptyLine>;
  return <>
    <div className="au-list">{page.map(job => <JobRow key={str(job.id)} job={job} trunk={trunkNameOf(data.trunks, job.agentId, data.defaultId)} runs={data.runs.get(str(job.id))?.entries ?? []} total={data.runs.get(str(job.id))?.total} level={level} canWrite={write} busy={busy || open !== null} actions={actions} />)}</div>
    {adv && !shown.length && <p className="au-hint">No automations match these filters.</p>}
    {adv && shown.length > 0 && <div className="au-more-row"><small>{page.length} of {shown.length}</small>{page.length < shown.length && <button type="button" className="btn ghost sm" onClick={() => setMore(more + 1)}>Show more</button>}</div>}
  </>;
}

export function ScheduledTab({ engine, level, openConversation }: Props) {
  const state = usePlaceData(engine, loadScheduled), { busy, run } = useAct(state.refresh);
  const [words, setWords] = useState(""), [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<Open>(null), [find, setFind] = useState<Find>(FIND0), [leaving, setLeaving] = useState(false);
  const write = canAdmin(engine), data = state.data, adv = shows(level, "advanced");
  const models = useModels(engine, level, Boolean(draft) || open?.kind === "sheet");
  const paused = data?.status.enabled === false;
  const agentFor = () => data?.defaultId || engine.agentId || "";
  const confirm = async (runNow: boolean) => {
    if (!draft) return;
    try { setError(""); if (draft.mode === "edit") updateParams(draft); else addParams(draft); } catch (e) { setError(errorText(e)); return; }
    let saved = "";
    if (!(await run(() => saveDraft(engine, draft).then(r => { saved = r.id; return r; }), r => str(r.message)))) return;
    // Saved: the card closes now, so a refused first run can never save it twice.
    setDraft(null); setWords("");
    if (runNow && saved) await run(async () => { const r = rec(await engine.request("cron.run", { id: saved, mode: "force" })); runOutcome(r); return r; }, `Running ${draft.name.trim()} now.`);
  };
  const setPaused = (p: boolean) => void run(() => patchConfig(engine, { cron: { enabled: !p } }), p ? "Every automation is paused." : "Automations resumed.");
  const act = (method: string, params: Row, message: string) => run(() => engine.request(method, params), message);
  const actions = {
    open: (job: Row) => setOpen({ kind: "sheet", job }),
    toggle: (job: Row) => void act("cron.update", { id: job.id, ...(job.configRevision ? { expectedConfigRevision: job.configRevision } : {}), patch: { enabled: job.enabled !== true } }, job.enabled ? `Paused ${jobName(job)}.` : `${jobName(job)} is on.`),
    menu: (job: Row, at: MenuAnchor) => setOpen({ kind: "menu", job, at }),
  };
  const menu = open?.kind === "menu" ? rowMenuItems(open.job, level, write, {
    runNow: (job, mode) => void run(async () => { const r = rec(await engine.request("cron.run", { id: job.id, mode })); runOutcome(r); return r; }, `Running ${jobName(job)}.`),
    change: job => { setError(""); setDraft(draftFromJob(job, "edit")); },
    duplicate: job => { setError(""); setDraft(draftFromJob(job, "copy", copyName(str(job.name), (data?.jobs ?? []).map(j => str(j.name))))); },
    sends: job => setOpen({ kind: "sends", job }), fails: job => setOpen({ kind: "fails", job }), remove: job => setOpen({ kind: "remove", job }),
  }) : [];
  const sum = data ? summaryLine(data.jobs.filter(j => !isTrigger(j))) : null;
  return <div className="au-tab">
    <p className="au-hint">Work a Trunk does on a schedule.</p>
    {paused && <PausedBanner canWrite={write} busy={busy} resume={() => setPaused(false)} />}
    <form className="au-describe" onSubmit={e => { e.preventDefault(); if (words.trim()) { setError(""); setDraft(draftFromWords(words, agentFor())); setWords(""); } else e.currentTarget.querySelector("input")?.focus(); }}>
      <input className="inp" aria-label="Describe a new automation" placeholder={"Describe it: “every weekday at 8, check my inbox for invoices”"} value={words} disabled={!write} title={write ? undefined : "Needs an owner"} onChange={e => setWords(e.target.value)} />
      <button type="submit" className="btn pri" disabled={!write}>Add</button>
    </form>
    {draft && <Proposal draft={draft} change={p => setDraft(d => d && { ...d, ...p })} level={level} trunks={data?.trunks ?? []} models={models} busy={busy} canWrite={write} error={error} onCancel={() => (draft && editChanged(draft) ? setLeaving(true) : setDraft(null))} onConfirm={runNow => void confirm(runNow)} />}
    {leaving && <LeaveDialog onKeep={() => setLeaving(false)} onLeave={() => {
      setLeaving(false); setDraft(null);
      notify("Nothing was changed."); // fakes-ok: F4 the preview's own toast after Leave (app-latest Change… leave dialog); not yet in DESIGN-SPEC
    }} />}
    {state.loading && !data && <p className="au-hint" role="status">Reading automations…</p>}
    {state.error && <p className="au-error" role="alert">{state.error}</p>}
    {adv && sum && sum.count > 0 && <p className="au-hint au-summary">{sum.count} automation{sum.count === 1 ? "" : "s"} · <span className={sum.failing ? "au-warn" : ""}>{sum.failing} failing</span>{sum.next ? ` · next run ${sum.next}` : ""}</p>}
    {adv && data && data.jobs.some(j => !isTrigger(j)) && <FindBar find={find} set={setFind} />}
    {data && <List data={data} find={find} level={level} write={write} busy={busy} actions={actions} open={open} />}
    <Ideas canWrite={write} pick={(title, message) => { setError(""); setDraft(draftFromIdea(title, message, agentFor())); }} />
    <StandingOrders />
    {adv && <RunningMore paused={paused} canWrite={write} busy={busy} setPaused={setPaused} />}
    <Reminders />
    {adv && data && <HowTheyreDoing jobs={data.jobs} runs={data.runs} />}
    {open?.kind === "menu" && <Menu at={open.at} label={`More for ${jobName(open.job)}`} items={menu} onClose={() => setOpen(null)} testid="au-row-menu" />}
    {open?.kind === "remove" && <RemoveDialog job={open.job} act={act} busy={busy} onClose={() => setOpen(null)} />}
    {open?.kind === "sends" && <SendsDialog job={open.job} act={act} busy={busy} level={level} trunks={data?.trunks ?? []} onClose={() => setOpen(null)} />}
    {open?.kind === "fails" && <FailDialog job={open.job} act={act} busy={busy} level={level} onClose={() => setOpen(null)} />}
    {open?.kind === "sheet" && <Sheet engine={engine} job={open.job} level={level} trunks={data?.trunks ?? []} models={models} canWrite={write} busy={busy} onClose={() => setOpen(null)} openConversation={openConversation}
      save={d => run(() => saveDraft(engine, d), r => str(r.message))} />}
  </div>;
}
