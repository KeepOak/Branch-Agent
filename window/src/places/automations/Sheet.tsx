// An automation's sheet (§4.6.3.1 "Its runs", preview p30-sched sheetPD18): tabs Runs · Settings. Runs reads
// cron.runs for this one job with the engine's own filters; "See what it did" reads cron.history for that run.
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../../shell/Dialog";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import type { Level } from "../../places-nav/level";
import type { WindowEngine } from "../../connect/engine";
import { Glyph } from "./glyphs";
import { jobName, scheduleWords, when } from "./model";
import { Proposal, type Trunk } from "./Proposal";
import { draftFromJob, type Draft } from "./draft";
import { errorText, rec, rows, str, type Row } from "./runtime";

export const RUN_WORDS: Record<string, string> = { ok: "Done", error: "Failed", skipped: "Skipped" };
export const SEND_WORDS: Record<string, string> = { delivered: "Sent", "not-delivered": "Not sent", "not-requested": "Nothing to send", unknown: "Unknown" };
const PAGE = 5;
type Filters = { query: string; status: string; delivery: string; dir: "desc" | "asc" };

export function runsParams(id: string, f: Filters, offset: number): Row {
  return { scope: "job", id, limit: PAGE, offset, sortDir: f.dir, ...(f.query.trim() ? { query: f.query.trim() } : {}), ...(f.status !== "all" ? { status: f.status } : {}), ...(f.delivery !== "all" ? { deliveryStatus: f.delivery } : {}) };
}

function useRuns(engine: WindowEngine, id: string, f: Filters) {
  const [items, setItems] = useState<Row[]>([]), [more, setMore] = useState(false), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const r = rec(await engine.request("cron.runs", runsParams(id, f, offset)));
      const page = rows(r.entries);
      setItems(old => offset ? [...old, ...page] : page); setMore(r.hasMore === true); setError("");
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, [engine, id, f]);
  useEffect(() => { void load(0); }, [load]);
  return { items, more, error, loading, more_: () => void load(items.length) };
}

function RunRow({ run, open }: { run: Row; open: (r: Row) => void }) {
  const status = str(run.status), sent = str(run.deliveryStatus);
  return <div className="au-run">
    <div className="au-grow">
      <span className="au-pills"><span className={`au-pill ${status === "error" ? "bad" : status === "ok" ? "ok" : ""}`}><i />{RUN_WORDS[status] ?? "Not recorded"}</span>{sent && <span className="au-pill"><i />{SEND_WORDS[sent] ?? sent}</span>}</span>
      <small>{str(run.summary) || "No summary."}</small>
      {run.error ? <small className={status === "skipped" ? undefined : "au-bad"}>{str(run.error)}</small> : null}
    </div>
    <time className="au-time">{when(run.runAtMs ?? run.ts)}</time>
    <button type="button" className="btn ghost sm" onClick={() => open(run)}>See what it did</button>
  </div>;
}

function RunsTab({ engine, job, openRun }: { engine: WindowEngine; job: Row; openRun: (r: Row) => void }) {
  const [f, setF] = useState<Filters>({ query: "", status: "all", delivery: "all", dir: "desc" });
  const runs = useRuns(engine, str(job.id), f);
  const set = (p: Partial<Filters>) => setF(old => ({ ...old, ...p }));
  const filtered = f.query || f.status !== "all" || f.delivery !== "all";
  const running = typeof rec(job.state).runningAtMs === "number";
  return <div className="au-runs">
    <div className="au-filters">
      <input className="inp" aria-label="Search runs" placeholder="Search runs" value={f.query} onChange={e => set({ query: e.target.value })} />
      <select className="inp" aria-label="Status" value={f.status} onChange={e => set({ status: e.target.value })}><option value="all">Status: All</option><option value="ok">Done</option><option value="error">Failed</option><option value="skipped">Skipped</option></select>
      <select className="inp" aria-label="Sending" value={f.delivery} onChange={e => set({ delivery: e.target.value })}><option value="all">Sending: All</option><option value="delivered">Sent</option><option value="not-delivered">Not sent</option><option value="not-requested">Nothing to send</option></select>
      <button type="button" className="btn sm" onClick={() => set({ dir: f.dir === "desc" ? "asc" : "desc" })}>{f.dir === "desc" ? "Newest first" : "Oldest first"}</button>
      {filtered && <button type="button" className="btn ghost sm" onClick={() => setF({ query: "", status: "all", delivery: "all", dir: "desc" })}>Clear</button>}
    </div>
    {running && <div className="au-run"><span className="au-pill"><i />Running</span><small>Started {when(rec(job.state).runningAtMs)}</small></div>}
    {runs.error && <p className="au-error" role="alert">{runs.error}</p>}
    {runs.items.map((r, i) => <RunRow key={`${str(r.runId)}-${i}`} run={r} open={openRun} />)}
    {!runs.loading && !runs.error && !runs.items.length && <EmptyLine icon={<Glyph name="clock" size={22} />}>{filtered ? "No runs match." : "No runs yet. Runs show here once it starts."}</EmptyLine>}
    {runs.more && <button type="button" className="btn ghost sm" disabled={runs.loading} onClick={runs.more_}>Show more runs</button>}
  </div>;
}

function textOf(m: Row): string {
  const c = m.content;
  if (typeof c === "string") return c;
  return rows(c).map(p => str(p.text) || (p.type === "toolCall" || p.type === "tool_use" ? `Used ${str(p.name)}` : "")).filter(Boolean).join("\n");
}

/** One run's record, read-only (cron.history is bound to the recorded run, never a chosen conversation). */
export function RunRecord({ engine, job, run, onClose, openConversation }: { engine: WindowEngine; job: Row; run: Row; onClose: () => void; openConversation: (key: string) => void }) {
  const [state, setState] = useState<{ messages: Row[]; error: string; loading: boolean }>({ messages: [], error: "", loading: true });
  useEffect(() => {
    const params = { id: str(job.id), ...(run.runId ? { runId: str(run.runId) } : { runAtMs: run.runAtMs ?? run.ts }) };
    engine.request("cron.history", params).then(r => setState({ messages: rows(rec(r).messages), error: "", loading: false }), () => setState({ messages: [], error: "This run’s record can’t be opened.", loading: false }));
  }, [engine, job, run]);
  const key = str(run.sessionKey);
  return <Dialog wide title={`${jobName(job)} · ${when(run.runAtMs ?? run.ts)}`} onClose={onClose} footer={<>{key && <button type="button" className="btn sm" onClick={() => { onClose(); openConversation(key); }}>Open the conversation</button>}</>}>
    {state.error && <p className="au-error" role="alert">{state.error}</p>}
    {!state.loading && !state.error && !state.messages.length && <p className="au-hint">Nothing in this run yet.</p>}
    <div className="au-record">{state.messages.map((m, i) => { const t = textOf(m); return t ? <div key={i} className={`au-msg ${str(m.role)}`}><small>{m.role === "user" ? "Asked" : m.role === "assistant" ? "Answered" : "Step"}</small><p>{t}</p></div> : null; })}</div>
  </Dialog>;
}

type SheetProps = { engine: WindowEngine; job: Row; level: Level; trunks: Trunk[]; models: string[]; canWrite: boolean; busy: boolean; onClose: () => void; save: (d: Draft) => Promise<boolean>; openConversation: (key: string) => void };
export function Sheet(props: SheetProps) {
  const { engine, job, onClose } = props;
  const [tab, setTab] = useState<"runs" | "settings">("runs"), [run, setRun] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFromJob(job, "edit")), [error, setError] = useState("");
  const state = rec(job.state), next = typeof state.nextRunAtMs === "number" ? `Next ${when(state.nextRunAtMs)}` : "";
  const confirm = async () => { setError(""); try { if (await props.save(draft)) onClose(); } catch (e) { setError(errorText(e)); } };
  if (run) return <RunRecord engine={engine} job={job} run={run} onClose={() => setRun(null)} openConversation={props.openConversation} />;
  return <Dialog wide testid="au-sheet" title={jobName(job)} onClose={onClose}>
    <p className="au-hint">{scheduleWords(rec(job.schedule))}{next ? ` · ${next}` : ""}</p>
    <div className="au-tabs" role="tablist" aria-label="Automation">{(["runs", "settings"] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "runs" ? "Runs" : "Settings"}</button>)}</div>
    {tab === "runs" ? <RunsTab engine={engine} job={job} openRun={setRun} /> : <Proposal inSheet draft={draft} change={p => setDraft(d => ({ ...d, ...p }))} level={props.level} trunks={props.trunks} models={props.models} busy={props.busy} canWrite={props.canWrite} error={error} onCancel={() => setTab("runs")} onConfirm={() => void confirm()} />}
  </Dialog>;
}
