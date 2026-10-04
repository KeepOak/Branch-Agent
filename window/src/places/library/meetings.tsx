// Library › Meetings (preview 42-placesbp libMeetListPQ18 / libMeetReaderPQ18) on transcripts.list / get / export:
// search, Filters [A], In progress and day groups, pages; the reader with Notes, Transcript, Save, and
// Where it came from [A].
import { useRef, useState, type FormEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { num, optStr, rec, recs, str, strs, useOperation, useResource, trunkName, type Trunk } from "./data";
import { EmptyIcon, LibIcon, plural, Row } from "./parts";

export type Meeting = {
  selector: string; title?: string; providerId: string; providerName?: string; source?: { accountId?: string };
  startedAt: string; active: boolean; utteranceCount: number; overview?: string; agentId: string | null; lastUtteranceAt: string | null;
};
type Utterance = { sequence: number; speakerLabel?: string; startedAt?: string; text: string };
type Summary = { generatedAt: string; overview: string; decisions: string[]; actionItems: string[]; source?: "model" | "heuristic"; model?: string };
type Detail = { session: Meeting; summary?: Summary; utterances?: Utterance[]; nextCursor: string | null };
type Filters = { providerId: string; accountId: string; agentId: string; from: string; to: string };
const NO_FILTERS: Filters = { providerId: "", accountId: "", agentId: "", from: "", to: "" };

/** A transcript summary row read defensively; rows without a selector are left out. */
export function meetingOf(r: Record<string, unknown>): Meeting {
  return { selector: r.selector as string, title: optStr(r.title), providerId: str(r.providerId), providerName: optStr(r.providerName), source: { accountId: optStr(rec(r.source).accountId) },
    startedAt: str(r.startedAt), active: r.active === true, utteranceCount: num(r.utteranceCount) ?? 0, overview: optStr(r.overview), agentId: optStr(r.agentId) ?? null, lastUtteranceAt: optStr(r.lastUtteranceAt) ?? null };
}
const meetingsOf = (v: unknown) => recs(v).filter(r => typeof r.selector === "string" && r.selector).map(meetingOf);
function detailOf(raw: unknown): Detail | null {
  const r = rec(raw), s = rec(r.session);
  if (typeof s.selector !== "string") return null;
  const sum = r.summary === undefined ? undefined : rec(r.summary);
  return {
    session: meetingOf(s), nextCursor: optStr(r.nextCursor) ?? null,
    summary: sum && { generatedAt: str(sum.generatedAt), overview: str(sum.overview), decisions: strs(sum.decisions), actionItems: strs(sum.actionItems), source: sum.source === "model" || sum.source === "heuristic" ? sum.source : undefined, model: optStr(sum.model) },
    utterances: recs(r.utterances).filter(u => typeof u.text === "string").map((u, i) => ({ sequence: num(u.sequence) ?? i, speakerLabel: optStr(u.speakerLabel), startedAt: optStr(u.startedAt), text: u.text as string })),
  };
}

const time = (iso?: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
const lines = (n: number) => plural(n, "line saved", "lines saved");
const minutes = (iso: string) => (Number.isFinite(Date.parse(iso)) ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))} min` : "");

export function dayLabel(iso: string, now = Date.now()) {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Date not recorded";
  const diff = Math.round((day(now) - day(t)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(t);
  return `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[d.getDay()]} ${d.getDate()} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getMonth()]}`;
}

type Props = { engine: WindowEngine; level: Level; trunks: Trunk[]; openSettings?: (page: string) => void };

export function MeetingsTab(props: Props) {
  const [open, setOpen] = useState<string | null>(null);
  return <div className="lib-meet">{open ? <Reader {...props} selector={open} back={() => setOpen(null)} /> : <MeetingList {...props} open={setOpen} />}</div>;
}

function MeetingList({ engine, level, trunks, openSettings, open }: Props & { open: (s: string) => void }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const rawList = useResource<unknown>(engine, "transcripts.list", {
    limit: 50, ...(query ? { query } : {}), ...(cursor ? { cursor } : {}),
    ...(filters.providerId ? { providerId: filters.providerId } : {}), ...(filters.accountId ? { accountId: filters.accountId } : {}), ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.from ? { startedAfter: `${filters.from}T00:00:00.000Z` } : {}), ...(filters.to ? { startedBefore: `${filters.to}T00:00:00.000Z` } : {}),
  });
  const list = { ...rawList, data: rawList.data === null ? null : { sessions: meetingsOf(rec(rawList.data).sessions), nextCursor: optStr(rec(rawList.data).nextCursor) ?? null } };
  const narrowed = Boolean(query) || filters !== NO_FILTERS;
  const clear = () => { setQuery(""); setDraft(""); setFilters(NO_FILTERS); setCursors([]); };
  const rows = list.data?.sessions ?? [];
  const live = rows.filter(m => m.active), days = [...new Set(rows.filter(m => !m.active).map(m => dayLabel(m.startedAt)))];
  const search = (e: FormEvent) => { e.preventDefault(); setQuery(draft.trim()); setCursors([]); };
  return <>
    <p className="lib-hint lib-mhint">Notes and transcripts from meetings a Trunk sat in.</p>
    {list.data && !rows.length && !narrowed && !cursor ? <EmptyLine icon={<EmptyIcon name="people" />}>No meetings yet. When a Trunk takes meeting notes, they show here.{openSettings && <><br /><button type="button" className="link" onClick={() => openSettings("voice")}>Set up meeting notes</button></>}</EmptyLine> : <>
      <form className="lib-form lib-msearch" role="search" onSubmit={search}><input className="inp" aria-label="Search meetings" placeholder="Search meetings" value={draft} onChange={e => setDraft(e.target.value)} /><button type="submit" className="btn">Search</button></form>
      {shows(level, "advanced") && <MeetingFilters key={JSON.stringify(filters)} rows={rows} trunks={trunks} value={filters} apply={f => { setFilters(f); setCursors([]); }} clear={clear} />}
    </>}
    {list.loading && <p className="lib-hint" role="status">Loading…</p>}
    {list.error && <p className="lib-bad" role="alert">{list.error}</p>}
    {list.data && !rows.length && (narrowed || cursor) && <EmptyLine icon={<EmptyIcon name="search" />}>No meetings match your search.<br /><button type="button" className="btn sm" onClick={clear}>Clear filters</button></EmptyLine>}
    {!!live.length && <MeetingGroup title="In progress" rows={live} open={open} />}
    {days.map(d => <MeetingGroup key={d} title={d} rows={rows.filter(m => !m.active && dayLabel(m.startedAt) === d)} open={open} />)}
    {(cursor || list.data?.nextCursor) && <div className="lib-acts">
      <button type="button" className="btn sm" disabled={!cursor} onClick={() => setCursors([])}>First page</button>
      <button type="button" className="btn sm" disabled={!list.data?.nextCursor} onClick={() => list.data?.nextCursor && setCursors(c => [...c, list.data!.nextCursor!])}>Next page</button>
    </div>}
  </>;
}

function MeetingGroup({ title, rows, open }: { title: string; rows: Meeting[]; open: (s: string) => void }) {
  return <section className="lib-sec lib-msec"><div className="lib-sec-h"><h2>{title}</h2></div><div className="lib-plain">
    {rows.map(m => <Row key={m.selector} icon="people" title={m.title || "Meeting"} line={<>{[m.providerName || m.providerId, time(m.startedAt), lines(m.utteranceCount)].filter(Boolean).join(" · ")}<span className="lib-mnote">{m.overview || "No notes yet"}</span></>}>
      {m.active && <><span className="lib-pill work"><i />Listening</span><span className="lib-mono lib-elapsed">{minutes(m.startedAt)}</span></>}
      <button type="button" className="btn sm" onClick={() => open(m.selector)}>Open</button>
    </Row>)}
  </div></section>;
}

function MeetingFilters({ rows, trunks, value, apply, clear }: { rows: Meeting[]; trunks: Trunk[]; value: Filters; apply: (f: Filters) => void; clear: () => void }) {
  const [f, setF] = useState(value);
  const providers = [...new Map(rows.map(m => [m.providerId, m.providerName || m.providerId])).entries()];
  if (value.providerId && !providers.some(([id]) => id === value.providerId)) providers.push([value.providerId, value.providerId]);
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return <details className="lib-fold" data-testid="meeting-filters"><summary>Filters</summary>
    <div className="lib-fgrid">
      <label className="lib-fld"><span>Where</span><select className="inp" value={f.providerId} onChange={set("providerId")}><option value="">Any service</option>{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="lib-fld"><span>Account</span><input className="inp" value={f.accountId} onChange={set("accountId")} /></label>
      <label className="lib-fld"><span>Trunk</span><select className="inp" value={f.agentId} onChange={set("agentId")}><option value="">Any Trunk</option>{trunks.map(t => <option key={t.id} value={t.id}>{trunkName(t)}</option>)}</select></label>
      <label className="lib-fld"><span>Started on or after</span><input className="inp" type="date" value={f.from} onChange={set("from")} /></label>
      <label className="lib-fld"><span>Started before</span><input className="inp" type="date" value={f.to} onChange={set("to")} /></label>
    </div>
    <p className="lib-hint">Dates are in UTC; the first includes its day, the second doesn’t. Service, account and Trunk match exactly.</p>
    <div className="lib-acts"><button type="button" className="btn sm" onClick={() => apply({ ...f, accountId: f.accountId.trim() })}>Filter</button><button type="button" className="btn ghost sm" onClick={clear}>Clear filters</button></div>
  </details>;
}

function Reader({ engine, level, trunks, selector, back }: Props & { selector: string; back: () => void }) {
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [cursor, setCursor] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<Utterance[]>([]);
  const appended = useRef<string | null | undefined>(undefined);
  const rawDetail = useResource<unknown>(engine, "transcripts.get", { selector, includeUtterances: true, ...(cursor ? { cursor } : {}) });
  const parsed = rawDetail.data === null ? null : detailOf(rawDetail.data);
  const detail = { ...rawDetail, error: rawDetail.error ?? (rawDetail.data !== null && !parsed ? "The engine did not return this meeting." : null), data: parsed };
  const op = useOperation(engine);
  const m = detail.data?.session;
  const trunk = trunks.find(t => t.id === m?.agentId);
  const save = (format: "markdown" | "jsonl") => void op.run<{ data?: string; mimeType?: string; filename?: string }>("transcripts.export", { selector, format }, r => {
    if (typeof r?.data !== "string") throw new Error("The engine did not return the meeting’s file.");
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data), c => c.charCodeAt(0))], { type: r.mimeType || "application/octet-stream" }));
    const a = document.createElement("a"); a.href = url; a.download = r.filename || `meeting.${format === "jsonl" ? "jsonl" : "md"}`; a.click(); URL.revokeObjectURL(url);
  });
  return <div className="lib-reader" data-testid="meeting-reader">
    <button type="button" className="link" onClick={back}>‹ Meetings</button>
    {detail.loading && !m && <p className="lib-hint" role="status">Loading…</p>}
    {detail.error && <p className="lib-bad" role="alert">{detail.error}</p>}
    {m && <>
      <h2 className="lib-rtitle">{m.title || "Meeting"}</h2>
      <small className="lib-rsub">{time(m.startedAt)} · {lines(m.utteranceCount)}</small>
      {shows(level, "advanced") && <details className="lib-fold lib-src"><summary>Where it came from</summary><div className="lib-srcb">
        <small>{m.providerName || m.providerId}{m.source?.accountId ? ` · ${m.source.accountId}` : ""}</small>
        <small>{trunk ? `Taken by ${trunkName(trunk)}` : "Trunk not recorded"}</small>
        {m.lastUtteranceAt && <small>Last line said {time(m.lastUtteranceAt)}</small>}
        <small>{m.active ? "Ready to listen: it’s set up to listen, which doesn’t prove sound is arriving." : "Not listening."}</small>
      </div></details>}
      <div className="lib-acts"><button type="button" className="btn sm" disabled={op.busy} onClick={() => save("markdown")}><LibIcon name="download" />Save as Markdown</button><button type="button" className="btn sm" disabled={op.busy} onClick={() => save("jsonl")}><LibIcon name="download" />Save as JSON Lines</button></div>
      {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
      <div className="lib-seg lib-rtabs" role="tablist" aria-label="Meeting">{(["notes", "transcript"] as const).map(k => <button key={k} type="button" role="tab" aria-selected={tab === k} aria-checked={tab === k} onClick={() => setTab(k)}>{k === "notes" ? "Notes" : "Transcript"}</button>)}</div>
      <div role="tabpanel">{tab === "notes" ? <Notes m={m} summary={detail.data!.summary} /> : <Transcript m={m} lines={[...earlier, ...(detail.data!.utterances ?? [])]} more={detail.data!.nextCursor} loadMore={() => {
        if (detail.loading || !detail.data?.nextCursor || appended.current === cursor) return;
        appended.current = cursor;
        setEarlier(e => [...e, ...(detail.data!.utterances ?? [])]); setCursor(detail.data.nextCursor);
      }} />}</div>
    </>}
  </div>;
}

function Notes({ m, summary }: { m: Meeting; summary?: Summary }) {
  if (!summary) return <p className="lib-hint">No notes yet.</p>;
  const list = (title: string, items: string[]) => (items.length ? <div className="lib-dl"><h3>{title}</h3><ul>{items.map(x => <li key={x}>{x}</li>)}</ul></div> : null);
  return <>
    <p className="lib-mby">{summary.source === "model" ? `Written by ${summary.model || "your model"}` : "Picked out from the text"} · Made {time(summary.generatedAt)}</p>
    {m.active && <p className="lib-hint">Notes so far. Final notes are saved when it ends.</p>}
    <p className="lib-mtext">{summary.overview}</p>
    {list("Decided", summary.decisions)}{list("To do", summary.actionItems)}
    <p className="lib-hint">Check the transcript before relying on decisions or to-dos.</p>
  </>;
}

function Transcript({ m, lines: all, more, loadMore }: { m: Meeting; lines: Utterance[]; more: string | null; loadMore: () => void }) {
  const [draft, setDraft] = useState(""), [q, setQ] = useState("");
  const shown = q ? all.filter(l => l.text.toLowerCase().includes(q.toLowerCase())) : all;
  return <>
    {m.active && <p className="lib-live"><span className="lib-pill work"><i />Listening</span><span className="lib-mono">{minutes(m.startedAt)}</span></p>}
    {!all.length ? <p className="lib-hint">{m.active ? "Waiting for speech…" : "Nothing has been saved in this transcript yet."}</p> : <>
      <form className="lib-form" role="search" onSubmit={e => { e.preventDefault(); setQ(draft.trim()); }}><input className="inp" aria-label="Search within this transcript" placeholder="Search within this transcript" value={draft} onChange={e => setDraft(e.target.value)} /><button type="submit" className="btn">Search</button><button type="button" className="btn ghost" onClick={() => { setQ(""); setDraft(""); }}>Clear</button></form>
      {q && <p className="lib-hint">{shown.length ? `Lines matching “${q}”` : "No lines match."}</p>}
      <div className="lib-plain lib-lines">{shown.map(l => <div className="lib-row" key={l.sequence}><span className="lib-grow"><b>{l.speakerLabel || "Unknown speaker"} <span className="lib-mono">{time(l.startedAt)}</span></b><small>{l.text}</small></span></div>)}</div>
      {more && <button type="button" className="btn ghost sm" onClick={loadMore}>Load more lines</button>}
    </>}
  </>;
}
