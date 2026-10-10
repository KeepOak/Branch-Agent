// Settings › Seasons (DESIGN-SPEC §4.7.16.1): Rings on the memory engine's config
// (plugins.entries.memory-core.config.rings.*) and its doctor.memory.* readouts and actions, Budding on the skill
// workshop (skills.workshop.autonomous.mode, skills.proposals.list), the season's changes, and session backfill.
// Skill maintenance is the engine's weekly skill collection review (a system cron job per Trunk): Look now runs it
// with cron.run and shows its last outcome from cron.runs. Resting and setting skills aside is retired in the engine.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { Btn, Ctl, Empty, Hint, Num, Page, Pick, Prow, Sec, Seg, Status, Switch, useConfig, useScope, type RowEntry } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { runOutcome } from "../../automations/act";
import { CallLine, CodeRow, lvOf, rec, str, useCall, useLive, when, type RecordValue } from "./common";

const RINGS = "plugins.entries.memory-core.config.rings";
const LEDE = "How Branch gets better by itself: tidying memory overnight, keeping skills in shape and learning what a Trunk couldn’t do. Every change is shown and can be undone.";
const REVIEW_JOB = "skill-collection-review-";
const REVIEW_SUB = "Reads every skill this Trunk wrote, merges repeats and retires what’s out of date. It runs once a week.";
const REVIEW_STATUS: Record<string, string> = { ok: "finished", error: "failed", skipped: "was skipped" };
const NO_UNDO = "Undoing a change needs the engine’s roll back.";
const TERMINAL = "Runs from a terminal; Technical shows the command.";
const NIGHT: Record<string, string> = { "0 1 * * *": "1", "0 3 * * *": "3", "0 5 * * *": "5" };
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Africa/Lagos", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];

export const ROWS: RowEntry[] = [
  ["Tidy memory at night with Rings", "Rings", 0], ["Night window", "Rings", 0], ["Rings diary", "Rings", 0],
  ["Look at skills now", "Skill maintenance", 0],
  ["Learn what a Trunk can’t do yet", "Skill learning", 0], ["Highest step it may take", "Skill learning", 0],
  ["Keep a change only if it does better by", "Keeping a change", 0], ["Use paid models at night", "Keeping a change", 0],
  ["What each night costs", "Seasons, more", 1],
  ["Clear replayed notes", "Seasons, more", 1], ["What Rings is weighing", "Seasons, more", 1], ["Time zone for the night window", "Seasons, more", 1],
  ["Model that writes the diary", "Seasons, more", 1], ["Where Rings writes what it keeps", "Seasons, more", 1], ["Keep reports out of memory", "Seasons, more", 1],
  ["Keep notes for good now", "Rings, by hand", 1], ["Try a night without keeping anything", "Rings, by hand", 1], ["Fill in from past conversations", "Rings, by hand", 1],
  ["Exact schedule", "Rings, in depth", 2], ["Log each pass in detail", "Rings, in depth", 2],
  ["Fill the diary from past notes", "Rings, maintenance", 2], ["Remove filled-in entries", "Rings, maintenance", 2],
  ["Remove repeated diary entries", "Rings, maintenance", 2], ["Repair Rings’ files", "Rings, maintenance", 2],
].map(([title, sec, lv]) => ({ page: "seasons", title: String(title), sec: String(sec), group: ({ "Rings, by hand": "Rings", "Rings, in depth": "Rings", "Rings, maintenance": "Rings", "Seasons, more": "Seasons" } as Record<string, string>)[String(sec)] ?? String(sec), lv: lv as 0 | 1 | 2 }));

type Config = ReturnType<typeof useConfig>;
type Ctx = SettingsPageProps & { config: Config; agent: string; status: RecordValue; reload: () => void };

export function SeasonsPage(props: SettingsPageProps) {
  const lv = lvOf(props.level);
  const config = useConfig(props.engine);
  const agent = useScope() ?? props.engine.agentId ?? "";
  const params = agent ? { agentId: agent } : {};
  const status = useLive<RecordValue>(props.engine, "doctor.memory.status", params, ["memory", "agents.changed", "config.changed"]);
  const proposals = useLive<RecordValue>(props.engine, "skills.proposals.list", params, ["skills"]);
  const ctx: Ctx = { ...props, config, agent, status: rec(rec(status.data).rings), reload: () => void status.reload() };
  return (
    <Page title={props.title} lede={LEDE}>
      <SeasonStatus rings={ctx.status} proposals={list(rec(proposals.data).proposals)} error={status.error} />
      <RingsSec {...ctx} />
      <SkillReview {...ctx} />
      <Budding {...ctx} />
      <Sec title="Keeping a change">
        <Ctl title="Keep a change only if it does better by" sub="Measured on practice runs of your recent tasks." off="Needs the engine’s practice runs."><Num label="Keep a change only if it does better by" value={undefined} unit="%" onCommit={() => undefined} /></Ctl>
        <Ctl title="Use paid models at night" sub="Rings uses your usual model while you sleep." help="Rings uses your usual model while you sleep. Off: Seasons uses only the model on this computer." off="Choose the model that writes the diary in Seasons, more."><Switch label="Use paid models at night" checked onChange={() => undefined} /></Ctl>
      </Sec>
      <ThisSeason rings={ctx.status} proposals={list(rec(proposals.data).proposals)} />
      {lv >= 1 ? <More {...ctx} /> : null}
      {lv >= 1 ? <ByHand {...ctx} lv={lv} /> : null}
      {lv >= 2 ? <InDepth {...ctx} /> : null}
      {lv >= 2 ? <Maintenance {...ctx} /> : null}
    </Page>
  );
}

function SeasonStatus({ rings, proposals, error }: { rings: RecordValue; proposals: RecordValue[]; error?: string }) {
  if (error) return <Status tone="bad" title="Branch couldn’t read Rings">{error}</Status>;
  if (!rings.phases) return null;
  const kept = Number(rings.promotedTotal) || 0;
  const learned = proposals.filter((p) => p.status === "applied").length;
  const next = rec(rec(rings.phases).deep).nextRunAtMs;
  const bits = [rings.lastPromotedAt ? `Rings last kept a note ${when(Date.parse(str(rings.lastPromotedAt)))}` : "Rings hasn’t kept a note yet",
    rings.enabled === false ? "Rings is off" : next ? `next night ${when(next)}` : "", learned ? `${learned} new ${learned === 1 ? "ability" : "abilities"}` : ""].filter(Boolean);
  return <Status tone={rings.enabled === false ? "idle" : "ok"} title={`This season: ${kept + learned} ${kept + learned === 1 ? "change" : "changes"} kept`}>{bits.join(" · ")}.</Status>;
}

function RingsSec({ engine, config, agent }: Ctx) {
  const [diary, setDiary] = useState(false);
  const enabled = config.get(`${RINGS}.enabled`) !== false;
  const cron = str(config.get(`${RINGS}.frequency`)) || "0 3 * * *";
  const night = NIGHT[cron] ?? "custom";
  return (
    <Sec title="Rings">
      <Ctl title="Tidy memory at night with Rings" sub="Merges repeats, keeps what matters and lets go of what’s unused." help="Merges repeats, keeps what matters and lets go of what’s unused. Every change is in the diary.">
        <Switch label="Tidy memory at night with Rings" checked={enabled} disabled={config.loading} onChange={(on) => void config.set(`${RINGS}.enabled`, on)} />
      </Ctl>
      <Ctl title="Night window" sub={night === "custom" ? `Custom: ${cron}. Rings starts when the window opens and runs until it is done.` : "Rings starts when the window opens and runs until it is done."}>
        <Seg label="Night window" value={night} disabled={config.loading || !enabled} onChange={(h) => void config.set(`${RINGS}.frequency`, `0 ${h} * * *`)}
          options={[{ id: "1", label: "1 AM" }, { id: "3", label: "3 AM" }, { id: "5", label: "5 AM" }, ...(night === "custom" ? [{ id: "custom", label: "Custom", off: "Set in Rings, in depth." }] : [])]} />
      </Ctl>
      <Ctl title="Rings diary" sub="Every merge and every fact let go, night by night."><Btn sm onClick={() => setDiary(true)}>Read it</Btn></Ctl>
      {diary ? <DiaryDialog engine={engine} agent={agent} onClose={() => setDiary(false)} /> : null}
    </Sec>
  );
}

function DiaryDialog({ engine, agent, onClose }: Pick<SettingsPageProps, "engine"> & { agent: string; onClose: () => void }) {
  const diary = useLive<RecordValue>(engine, "doctor.memory.dreamDiary", agent ? { agentId: agent } : {}, []);
  const d = rec(diary.data);
  return (
    <Dialog title="Rings diary" wide onClose={onClose}>
      {diary.error ? <p className="s2-err" role="alert">{diary.error}</p> : null}
      {diary.loading && !diary.data ? <p>Loading…</p> : null}
      {diary.data && d.found !== true ? <p className="hint">The diary is empty. Rings writes in it after its first night.</p> : null}
      {d.found === true ? <pre className="s2-pre s2-diary">{str(d.content)}</pre> : null}
      {d.path ? <p className="hint">{str(d.path)}</p> : null}
    </Dialog>
  );
}

/** Budding: the skill workshop learns from corrections and finished work and proposes skills (always asks). */
function Budding({ config }: Ctx) {
  const mode = str(config.get("skills.workshop.autonomous.mode")) || "off";
  return (
    <Sec title="Skill learning">
      <Ctl title="Learn what a Trunk can’t do yet" sub="Tries simple fixes first and learns from your corrections." help="It tries the simplest way first, and learns from your corrections and finished work as skills. Installing anything, writing its own tool or changing Branch’s code always asks you.">
        <Switch label="Learn what a Trunk can’t do yet" checked={mode !== "off"} disabled={config.loading} onChange={(on) => void config.set("skills.workshop.autonomous.mode", on ? "propose" : "off")} />
      </Ctl>
      <Ctl title="Highest step it may take" sub="Steps above this aren’t tried." off="Automatic learning supports skills only in this engine.">
        <Seg label="Highest step it may take" value="skill" onChange={() => undefined} options={[{ id: "skill", label: "A skill" }, { id: "addon", label: "An add-on" }, { id: "tool", label: "Its own tool" }, { id: "code", label: "Branch’s code" }]} />
      </Ctl>
    </Sec>
  );
}

/** Skill maintenance: the Trunk's skill collection review job (engine cron/skill-collection-review-monitor). */
function SkillReview({ engine, agent }: Ctx) {
  const jobs = useLive<RecordValue>(engine, "cron.list", agent ? { includeDisabled: true, agentId: agent, limit: 200 } : { includeDisabled: true, limit: 200 }, ["cron"]);
  const all = list(rec(jobs.data).jobs);
  const job = all.find((j) => str(j.name) === `${REVIEW_JOB}${agent}`) ?? (agent ? undefined : all.find((j) => str(j.name).startsWith(REVIEW_JOB)));
  const off = jobs.error ? `Branch couldn’t read the review: ${jobs.error}`
    : !jobs.data ? "Reading the review…"
    : !job ? "This Trunk has no skill review."
    : job.enabled === false ? (str(job.displayName).startsWith("[no-rooted-runtime]") ? "This Trunk’s model can’t run the review in its skill folder." : "Reviews run only while skill learning may change skills by itself.")
    : undefined;
  return (
    <Sec title="Skill maintenance">
      {job && !off ? <ReviewNow engine={engine} job={job} /> : <Ctl title="Look at skills now" sub={REVIEW_SUB} off={off}><Btn sm>Look now</Btn></Ctl>}
    </Sec>
  );
}

function ReviewNow({ engine, job }: Pick<SettingsPageProps, "engine"> & { job: RecordValue }) {
  const id = str(job.id);
  const runs = useLive<RecordValue>(engine, "cron.runs", { scope: "job", id, limit: 1, sortDir: "desc" }, ["cron"]);
  const [started, setStarted] = useState("");
  const [read, setRead] = useState(false);
  const call = useCall();
  const last = list(rec(runs.data).entries)[0];
  const running = typeof rec(job.state).runningAtMs === "number" || (started !== "" && str(last?.runId) !== started);
  const look = () => void call.run(async () => { const r = rec(await engine.request("cron.run", { id, mode: "force" })); runOutcome(r); setStarted(str(r.runId)); return r; });
  const outcome = last ? `Last look ${when(last.ts)}: it ${REVIEW_STATUS[str(last.status)] ?? "finished"}.` : "";
  const sub = call.error ?? (running ? "Looking at skills now. It can take a few minutes." : outcome || REVIEW_SUB);
  const text = last ? str(last.summary) || str(last.error) : "";
  return (
    <Ctl title="Look at skills now" sub={sub} help={REVIEW_SUB}>
      {text && !running ? <Btn sm ghost onClick={() => setRead(true)}>What it did</Btn> : null}
      <Btn sm disabled={call.busy || running} onClick={look}>{running ? "Looking…" : "Look now"}</Btn>
      {read ? <Dialog title="Skill review" wide onClose={() => setRead(false)}><p className="hint">{outcome}</p><pre className="s2-pre">{text}</pre></Dialog> : null}
    </Ctl>
  );
}

type Change = { id: string; who: "rings" | "budding"; text: string; at: number; note?: string };
function changes(rings: RecordValue, proposals: RecordValue[]): Change[] {
  const kept = list(rings.promotedEntries).map((e, i): Change => ({ id: `r${i}`, who: "rings", text: `Kept “${str(e.snippet) || str(e.key)}” for good`, at: Date.parse(str(e.promotedAt) || str(e.lastRecalledAt)) || 0, note: str(e.path) }));
  const learned = proposals.map((p): Change => ({ id: str(p.id), who: "budding", text: p.status === "applied" ? `Learned “${str(p.title)}”, as a skill` : `Suggested “${str(p.title)}” (${str(p.status)})`, at: Date.parse(str(p.updatedAt)) || 0, note: str(p.skillName) }));
  return [...kept, ...learned].sort((a, b) => b.at - a.at);
}

function ThisSeason({ rings, proposals }: { rings: RecordValue; proposals: RecordValue[] }) {
  const [filter, setFilter] = useState("all");
  const all = changes(rings, proposals);
  const shown = all.filter((c) => filter === "all" || c.who === filter);
  return (
    <Sec title="This season">
      <div className="acts s2-filter">{[["all", "All"], ["rings", "Rings"], ["budding", "Budding"]].map(([id, label]) => <button key={id} type="button" className="chip6" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {shown.length ? (
        <ol className="s2-tl s2-season">
          {shown.map((c) => (
            <li key={c.id} className="ok">
              <span>{c.text}<small>{c.who === "rings" ? "Rings" : "Budding"} · {when(c.at)}</small>{c.note ? <code className="s2-rec">{c.note}</code> : null}</span>
              <span className="acts"><Btn sm ghost disabled title={NO_UNDO}>Undo</Btn></span>
            </li>
          ))}
        </ol>
      ) : <Empty>No changes yet this season.</Empty>}
    </Sec>
  );
}

function More({ engine, config, agent, status, reload }: Ctx) {
  const [weigh, setWeigh] = useState(false);
  const clear = useCall();
  const models = useLive<RecordValue>(engine, "models.list", {}, []);
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone = str(config.get(`${RINGS}.timezone`));
  const model = str(config.get(`${RINGS}.model`));
  const storage = str(config.get(`${RINGS}.storage.mode`)) || "separate";
  const opts = list(rec(models.data).models).filter((m) => m.available !== false).map((m) => ({ id: `${str(m.provider)}/${str(m.id)}`, label: str(m.name) || str(m.id) }));
  return (
    <Sec title="Seasons, more" group="Seasons">
      <Ctl title="What each night costs" sub="Shows what each night’s model use costs." help="Each night’s model use: free on this computer, or the plan it used when paid models are allowed." off="Needs the engine to record each night’s model use."><Btn sm>See the nights</Btn></Ctl>
      <Ctl title="Clear replayed notes" sub={clear.note ?? clear.error ?? "Removes the notes Rings pulled back from older daily logs and is still weighing. Nothing already kept is touched."}>
        <Btn sm disabled={clear.busy} onClick={() => void clear.run(() => engine.request<RecordValue>("doctor.memory.resetGroundedShortTerm", agent ? { agentId: agent } : {}), (r) => { reload(); return `Cleared ${str(rec(r).removedShortTermEntries) || "0"} notes.`; })}>Clear</Btn>
      </Ctl>
      <Ctl title="What Rings is weighing" sub="Notes waiting to be kept for good, and where each came from."><Btn sm onClick={() => setWeigh(true)}>Review</Btn></Ctl>
      <Ctl title="Time zone for the night window" sub="The night window is read in this time zone.">
        <Pick label="Time zone for the night window" value={zone} disabled={config.loading} onChange={(v) => void config.set(`${RINGS}.timezone`, v || null)} options={[{ id: "", label: `This computer’s (${here.replace(/_/g, " ")})` }, ...ZONES.map((z) => ({ id: z, label: z.replace(/_/g, " ") }))]} />
      </Ctl>
      <Ctl title="Model that writes the diary" sub="Writes the Rings diary’s sentences.">
        <Pick label="Model that writes the diary" value={model} disabled={config.loading} onChange={(v) => void config.set(`${RINGS}.model`, v || null)} options={[{ id: "", label: "Each Trunk’s own model" }, ...opts]} />
      </Ctl>
      <Ctl title="Where Rings writes what it keeps" sub="Choose where kept notes and nightly reports are written." help="In memory writes into the memory file; its own file keeps a separate report. Where kept notes and nightly reports are written.">
        <Seg label="Where Rings writes what it keeps" value={storage} disabled={config.loading} onChange={(v) => void config.set(`${RINGS}.storage.mode`, v)} options={[{ id: "inline", label: "In memory" }, { id: "separate", label: "Its own file" }, { id: "both", label: "Both" }]} />
      </Ctl>
      <Ctl title="Keep reports out of memory" sub="Rings’ nightly reports stay out of the main memory file.">
        <Switch label="Keep reports out of memory" checked={config.get(`${RINGS}.storage.separateReports`) === true} disabled={config.loading} onChange={(on) => void config.set(`${RINGS}.storage.separateReports`, on)} />
      </Ctl>
      {weigh ? <WeighDialog status={status} onClose={() => setWeigh(false)} /> : null}
    </Sec>
  );
}

function WeighDialog({ status, onClose }: { status: RecordValue; onClose: () => void }) {
  const entries = list(status.shortTermEntries);
  return (
    <Dialog title="What Rings is weighing" wide onClose={onClose}>
      <p className="hint">{entries.length} {entries.length === 1 ? "note" : "notes"} waiting to be kept for good.</p>
      {entries.length ? <div className="rows">{entries.map((e, i) => <Prow key={i} title={str(e.snippet) || str(e.key)} sub={[`${str(e.path)}:${str(e.startLine)}`, typeof e.recallCount === "number" ? `recalled ${e.recallCount} times` : "", typeof e.totalSignalCount === "number" ? `${e.totalSignalCount} signals` : ""].filter(Boolean).join(" · ")} />)}</div> : null}
    </Dialog>
  );
}

/** Rings, by hand (Advanced); the terminal commands behind it are Technical. */
function ByHand({ engine, agent, lv }: Ctx & { lv: number }) {
  const [fill, setFill] = useState(false);
  return (
    <Sec title="Rings, by hand" showHeading={false} group="Rings">
      <Ctl title="Keep notes for good now" sub="The notes the deep pass would keep, with why." off={lv >= 2 ? "Runs from a terminal: Keep notes now, below." : TERMINAL}><Btn sm>Preview</Btn></Ctl>
      <Ctl title="Try a night without keeping anything" sub="Shows what the pattern and deep passes would find. It writes nothing." off={lv >= 2 ? "Runs from a terminal: A night that keeps nothing, below." : TERMINAL}><Btn sm>Try it</Btn></Ctl>
      <Ctl title="Fill in from past conversations" sub="Writes diary entries from conversations you choose." help="Writes diary entries from conversations you pick; you can remove them all."><Btn sm disabled={!agent} onClick={() => setFill(true)}>Choose…</Btn></Ctl>
      {lv >= 2 ? (
        <>
          <CodeRow title="Keep notes now" code="branch memory promote" />
          <CodeRow title="Why a note scores as it does" code="branch memory promote-explain <note>" />
          <CodeRow title="A night that keeps nothing" code="branch memory rem-harness" />
          <CodeRow title="Fill the diary from a folder" code="branch memory rem-backfill --path <folder>" />
          <CodeRow title="Fill the diary from conversations" code="branch memory session-backfill --agent <id>" />
        </>
      ) : null}
      {fill ? <BackfillDialog engine={engine} agent={agent} onClose={() => setFill(false)} /> : null}
    </Sec>
  );
}

/** Fill in from past conversations: memory.sessionBackfill.preview, then apply; rollback removes them all. */
function BackfillDialog({ engine, agent, onClose }: Pick<SettingsPageProps, "engine"> & { agent: string; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const [preview, setPreview] = useState<RecordValue | null>(null);
  const call = useCall();
  const look = () => void call.run(async () => setPreview(rec(await engine.request("memory.sessionBackfill.preview", { agentId: agent, limitDays: days }))));
  const apply = () => void call.run(() => engine.request("memory.sessionBackfill.apply", { agentId: agent, limitDays: days }), () => "Written to the diary.");
  const undo = () => void call.run(() => engine.request("memory.sessionBackfill.rollback", { agentId: agent }), () => "Removed every filled-in entry.");
  return (
    <Dialog title="Fill in from past conversations" onClose={onClose} footer={<><Btn ghost disabled={call.busy} onClick={undo}>Remove them all</Btn><Btn pri disabled={call.busy || !preview} onClick={apply}>Write them</Btn></>}>
      <Ctl title="Conversations from the last"><Num label="Conversations from the last" value={days} unit="days" min={1} onCommit={(v) => { setDays(v ?? 7); setPreview(null); }} /><Btn sm disabled={call.busy} onClick={look}>Preview</Btn></Ctl>
      {preview ? <pre className="s2-pre">{JSON.stringify(preview, null, 2)}</pre> : <Hint>Preview first: nothing is written until you choose Write them.</Hint>}
      <CallLine call={call} />
    </Dialog>
  );
}

const PHASES: { id: "light" | "deep" | "rem"; title: string; hint: string; rows: [string, string, string?][] }[] = [
  { id: "light", title: "Light pass", hint: "Sorts recent notes and picks ones worth a second look.", rows: [["lookbackDays", "Look back", "days"], ["limit", "At most", "notes"], ["dedupeSimilarity", "Treat as the same above"]] },
  { id: "deep", title: "Deep pass", hint: "Scores notes and keeps the best for good.", rows: [["limit", "At most", "notes"], ["minScore", "Lowest score"], ["minRecallCount", "Recalled at least", "times"], ["minUniqueQueries", "From at least", "different questions"], ["recencyHalfLifeDays", "Older signals count half after", "days"], ["maxAgeDays", "Ignore notes older than", "days"], ["maxPromotedSnippetTokens", "Longest kept snippet", "tokens"]] },
  { id: "rem", title: "Pattern pass", hint: "Looks for themes that keep coming back.", rows: [["lookbackDays", "Look back", "days"], ["limit", "At most", "notes"], ["minPatternStrength", "Lowest pattern strength"]] },
];

/** Rings, in depth: the exact schedule and every phase's numbers; empty = the engine's default (shown as the hint). */
function InDepth({ config, status }: Ctx) {
  const cron = str(config.get(`${RINGS}.frequency`));
  const phases = rec(status.phases);
  return (
    <Sec title="Rings, in depth" showHeading={false} group="Rings" hint="Fine tuning for each of Rings’ three passes.">
      <Ctl title="Exact schedule" sub="Five-field cron." help="Five-field cron. Setting it makes Night window read “Custom”; empty uses the night window. Overrides the night window.">
        <input className="inp s2-mono" aria-label="Exact schedule" defaultValue={cron} placeholder="0 3 * * *" onBlur={(e) => { const v = e.target.value.trim(); if (v !== cron) void config.set(`${RINGS}.frequency`, v || null); }} />
      </Ctl>
      {PHASES.map((p) => (
        <div key={p.id}>
          <h3 className="s2-h3">{p.title}</h3>
          <Hint>{p.hint}</Hint>
          <Ctl title="Run it" id={`${p.id}-run`}><Switch label={`${p.title}: run it`} checked={config.get(`${RINGS}.phases.${p.id}.enabled`) !== false} onChange={(on) => void config.set(`${RINGS}.phases.${p.id}.enabled`, on)} /></Ctl>
          {p.rows.map(([key, title, unit]) => {
            const saved = config.get(`${RINGS}.phases.${p.id}.${key}`);
            const engineValue = rec(phases[p.id])[key];
            return <Ctl key={key} title={title} id={`${p.id}-${key}`}><Num label={`${p.title}: ${title}`} unit={unit} value={typeof saved === "number" ? saved : undefined} placeholder={typeof engineValue === "number" ? String(engineValue) : undefined} onCommit={(v) => void config.set(`${RINGS}.phases.${p.id}.${key}`, v)} /></Ctl>;
          })}
        </div>
      ))}
      <Ctl title="Log each pass in detail" sub="For tuning the numbers above." help="For tuning the numbers above. Off until you choose: it writes a lot to the log.">
        <Switch label="Log each pass in detail" checked={config.get(`${RINGS}.verboseLogging`) === true} onChange={(on) => void config.set(`${RINGS}.verboseLogging`, on)} />
      </Ctl>
    </Sec>
  );
}

/** Rings, maintenance: the diary and Rings' files, on doctor.memory.* actions. */
function Maintenance({ engine, agent, status, reload }: Ctx) {
  const call = useCall();
  const params = agent ? { agentId: agent } : {};
  const act = (method: string, note: (r: RecordValue) => string) => void call.run(() => engine.request<RecordValue>(method, params), (r) => { reload(); return note(rec(r)); });
  return (
    <Sec title="Rings, maintenance" showHeading={false} group="Rings" hint={`${str(status.shortTermCount) || "0"} notes waiting · ${str(status.promotedToday) || "0"} kept today · ${str(status.promotedTotal) || "0"} kept in all`}>
      <Ctl title="Fill the diary from past notes"><Btn sm disabled={call.busy} onClick={() => act("doctor.memory.backfillDreamDiary", (r) => `Wrote ${str(r.written) || "0"} entries from ${str(r.scannedFiles) || "0"} notes.`)}>Fill in</Btn></Ctl>
      <Ctl title="Remove filled-in entries"><Btn sm disabled={call.busy} onClick={() => act("doctor.memory.resetDreamDiary", (r) => `Removed ${str(r.removedEntries) || "0"} entries.`)}>Remove</Btn></Ctl>
      <Ctl title="Remove repeated diary entries" sub="Only exact repeats."><Btn sm disabled={call.busy} onClick={() => act("doctor.memory.dedupeDreamDiary", (r) => `Removed ${str(r.removedEntries) || str(r.removed) || "0"} repeats.`)}>Remove repeats</Btn></Ctl>
      <Ctl title="Repair Rings’ files"><Btn sm disabled={call.busy} onClick={() => act("doctor.memory.repairRingsArtifacts", (r) => (r.changed === true ? `Repaired. The old files are in ${str(r.archiveDir)}.` : "Nothing needed repair."))}>Repair</Btn></Ctl>
      <CallLine call={call} />
      {status.storeError ? <p className="hint s2-err">{str(status.storeError)}</p> : null}
    </Sec>
  );
}
