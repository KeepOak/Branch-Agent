// Settings › Advanced, the windows it opens: the gateway log (logs.tail, live), all conversations (sessions.list,
// renamed through sessions.patch), a settings section as JSON (config.patch as a merge patch, with every field from
// config.schema), health readouts (status, health, diagnostics.lanes, diagnostics.stability), web search
// (webSearch.status / webSearch.test), hooks (hooks.status) and bringing other agents' memory in (migrations.memory.*).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Btn, Ctl, Hint, Pill, Prow, Sec, usePinsKit, type Lv } from "../kit";
import { Icon } from "../../../shell/icons";
import { errorText, list } from "../adapter";
import { configStore, type ConfigPath } from "../config-store";
import { Dialog } from "../../../shell/Dialog";
import { useBranchVersion, versionParts } from "../../../connect/branch-version";
import { CallLine, CopyBtn, Kv, rec, str, useCall, useLive, when, type RecordValue } from "./common";
import type { Ctx } from "./advanced-more";

/* ---------- the log window ---------- */
type Line = { time: string; level: string; text: string; raw: string };
const LEVEL_CHIPS: [string, string[]][] = [["Trace", ["trace", "silly"]], ["Debug", ["debug"]], ["Info", ["info", ""]], ["Warning", ["warn", "warning"]], ["Error", ["error"]], ["Fatal", ["fatal"]]];

/** One gateway log line (JSON from the engine's logger; anything else is kept as plain text). */
export function parseLine(raw: string): Line {
  try {
    const j = rec(JSON.parse(raw));
    const meta = rec(j._meta);
    const parts = Object.keys(j).filter((k) => /^\d+$/.test(k)).map((k) => (typeof j[k] === "string" ? String(j[k]) : JSON.stringify(j[k])));
    const head = parts[0]?.startsWith("{") ? str(rec(JSON.parse(parts[0])).subsystem) : "";
    const text = (head ? [`${head}:`, ...parts.slice(1)] : parts).join(" ");
    return { time: str(j.time) || str(meta.date), level: (str(meta.logLevelName) || str(j.level)).toLowerCase(), text, raw };
  } catch {
    return { time: "", level: "", text: raw, raw };
  }
}

function useLogTail(engine: WindowEngine) {
  const [state, setState] = useState<{ lines: Line[]; file: string; error?: string }>({ lines: [], file: "" });
  const cursor = useRef<number | undefined>(undefined);
  const pull = useCallback(async () => {
    try {
      const r = rec(await engine.request("logs.tail", cursor.current === undefined ? { limit: 500 } : { cursor: cursor.current, limit: 500 }));
      const fresh = (Array.isArray(r.lines) ? r.lines : []).map((x) => parseLine(String(x)));
      const first = cursor.current === undefined || r.reset === true;
      cursor.current = typeof r.cursor === "number" ? r.cursor : cursor.current;
      setState((s) => ({ lines: (first ? fresh : [...s.lines, ...fresh]).slice(-2000), file: str(r.file) || s.file }));
    } catch (error) {
      setState((s) => ({ ...s, error: errorText(error) }));
    }
  }, [engine]);
  return { ...state, pull };
}

const clock = (t: string) => { const d = Date.parse(t); return Number.isFinite(d) ? new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""; };
const chipOf = (level: string) => LEVEL_CHIPS.find(([, ids]) => ids.includes(level))?.[0] ?? "Info";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Logs: follow new lines, level chips, search, export, copy. `source` pre-fills the search for a service tile. */
export function LogsDialog({ engine, source, onClose }: { engine: WindowEngine; source?: { name: string; filter: string }; onClose: () => void }) {
  const tail = useLogTail(engine);
  const [follow, setFollow] = useState(true);
  const [q, setQ] = useState(source?.filter ?? "");
  const [levels, setLevels] = useState<Record<string, boolean>>(Object.fromEntries(LEVEL_CHIPS.map(([l]) => [l, true])));
  const box = useRef<HTMLDivElement>(null);
  const { pull } = tail;
  useEffect(() => { void pull(); if (!follow) return; const id = setInterval(() => void pull(), 2000); return () => clearInterval(id); }, [follow, pull]);
  const shown = tail.lines.filter((l) => levels[chipOf(l.level)] && (!q || `${l.level} ${l.text}`.toLowerCase().includes(q.toLowerCase())));
  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length, follow]);
  const filtered = Boolean(q) || Object.values(levels).some((v) => !v);
  return (
    <Dialog title="Logs" wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <p className="hint s2advanced-gap">{source ? `${source.name}’s lines in the gateway’s log, newest at the bottom.` : "The gateway’s log, newest at the bottom."}</p>
      <div className="s2advanced-logbar">
        <label className="s2advanced-swl"><input className="sw" type="checkbox" checked={follow} aria-label="Follow new lines" onChange={(e) => setFollow(e.target.checked)} /> Follow new lines</label>
        <Btn sm ghost onClick={() => void pull()}>Refresh</Btn>
        <input className="inp" placeholder="Search logs" aria-label="Search logs" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn sm ghost disabled={!shown.length} onClick={() => download("branch-log.txt", shown.map((l) => l.raw).join("\n"))}>{filtered ? "Export filtered" : "Export visible"}</Btn>
        <CopyBtn text={shown.map((l) => `${l.time} ${l.level.toUpperCase()} ${l.text}`).join("\n")} label="Copy the log" />
      </div>
      <div className="s2-chips s2advanced-gap">{LEVEL_CHIPS.map(([l]) => <button key={l} type="button" className="chip6" aria-pressed={levels[l]} onClick={() => setLevels((s) => ({ ...s, [l]: !s[l] }))}>{l}</button>)}</div>
      {tail.error ? <p className="hint s2-err" role="alert">{tail.error}</p> : null}
      <div className="s2advanced-logbox" ref={box} tabIndex={0} aria-label="Log lines" onScroll={(e) => { const b = e.currentTarget; const atEnd = b.scrollHeight - b.scrollTop - b.clientHeight < 4; if (atEnd !== follow) setFollow(atEnd); }}>
        {shown.length ? shown.map((l, i) => <div key={i} className="s2advanced-ll"><time>{clock(l.time)}</time><span className={`s2advanced-lv s2advanced-lv-${chipOf(l.level).toLowerCase()}`}>{l.level || "info"}</span><span>{l.text}</span></div>)
          : <p className="empty">{tail.lines.length ? "No log lines match." : "No log lines yet."}</p>}
      </div>
      {tail.file ? <p className="hint">{tail.file}</p> : null}
    </Dialog>
  );
}

/* ---------- all conversations ---------- */
type SortKey = "name" | "kind" | "last" | "room" | "status" | "goal";
type Conv = { key: string; agentId: string; name: string; kind: string; last: number; room: number; status: string; goal: string; id: string };
function convOf(r: RecordValue): Conv {
  const room = Number(r.contextTokens) > 0 ? Math.min(100, Math.round((Number(r.totalTokens) / Number(r.contextTokens)) * 100)) : 0;
  const status = r.archived === true ? "Archived" : r.hasActiveRun === true ? "Working" : r.unread === true ? "Unread" : r.pinned === true ? "Pinned" : "";
  return { key: str(r.key), agentId: str(r.agentId), name: str(r.label) || str(r.displayName) || str(r.derivedTitle) || str(r.key), kind: str(r.kind), last: Number(r.updatedAt) || 0, room, status, goal: str(rec(r.goal).objective), id: str(r.sessionId) };
}
function Pips({ used }: { used: number }) {
  const n = Math.ceil(used / 20);
  const tone = used >= 80 ? "bad" : used >= 60 ? "warn" : "on";
  return <span className="s2advanced-pips" title={`${used}% of the room used`} aria-label={`${used}% of the room used`}>{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < n ? tone : ""} />)}</span>;
}
const COLS: [SortKey, string][] = [["name", "Name"], ["kind", "Kind"], ["last", "Last active"], ["room", "Room used"], ["status", "Status"], ["goal", "Goal"]];

export function ConvDialog({ engine, lv, onClose }: { engine: WindowEngine; lv: Lv; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<"Active" | "Archived" | "All">("Active");
  const [per, setPer] = useState(25);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "last", dir: -1 });
  const params = { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, includeDerivedTitles: true, archived: seg === "Active" ? false : seg === "Archived" ? true : "all", limit: per, offset: page * per, ...(q.trim() ? { search: q.trim() } : {}) };
  const res = useLive<RecordValue>(engine, "sessions.list", params, ["sessions"]);
  const data = rec(res.data);
  const rows = list(data.sessions).map(convOf).sort((a, b) => (a[sort.k] > b[sort.k] ? 1 : a[sort.k] < b[sort.k] ? -1 : 0) * sort.dir);
  const total = typeof data.totalCount === "number" ? data.totalCount : page * per + rows.length;
  const more = typeof data.nextOffset === "number" || (typeof data.totalCount === "number" ? (page + 1) * per < total : rows.length === per);
  const reset = (fn: () => void) => { fn(); setPage(0); };
  return (
    <Dialog title="All conversations" wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <div className="s2advanced-ctbar">
        <input className="inp" placeholder="Search conversations" aria-label="Search conversations" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        <span className="sseg" role="group" aria-label="Which conversations">{(["Active", "Archived", "All"] as const).map((o) => <button key={o} type="button" aria-pressed={seg === o} onClick={() => reset(() => setSeg(o))}>{o}</button>)}</span>
      </div>
      {res.error ? <p className="hint s2-err" role="alert">{res.error}</p> : null}
      <div className="s2advanced-ctwrap">
        {rows.length ? <ConvTable rows={rows} lv={lv} sort={sort} onSort={(k) => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "last" ? -1 : 1 }))} engine={engine} onSaved={() => void res.reload()} />
          : <p className="empty">{res.loading ? "Reading conversations…" : q ? "No conversation matches." : "No conversations yet."}</p>}
      </div>
      <div className="s2advanced-ctfoot">
        <label>Rows per page <select className="inp" value={per} onChange={(e) => reset(() => setPer(Number(e.target.value)))}>{[10, 25, 50, 100].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <span>{rows.length ? `${page * per + 1}–${page * per + rows.length} of ${total}` : "0 of 0"}</span>
        <Btn sm ghost disabled={!page} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
        <Btn sm ghost disabled={!more} onClick={() => setPage((p) => p + 1)}>Next</Btn>
      </div>
    </Dialog>
  );
}

function ConvTable({ rows, lv, sort, onSort, engine, onSaved }: { rows: Conv[]; lv: Lv; sort: { k: SortKey; dir: number }; onSort: (k: SortKey) => void; engine: WindowEngine; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const rename = useCall();
  const save = (c: Conv, label: string) => { setEdit(null); if (label.trim() && label.trim() !== c.name) void rename.run(() => engine.request("sessions.patch", { key: c.key, ...(c.agentId ? { agentId: c.agentId } : {}), label: label.trim() }), () => { onSaved(); return `Renamed to “${label.trim()}”.`; }); };
  return (
    <>
      <table className="s2advanced-ct">
        <thead><tr>{COLS.map(([k, l]) => <th key={k} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}><button type="button" className="s2advanced-thb" onClick={() => onSort(k)}>{l}{sort.k === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</button></th>)}{lv >= 2 ? <><th>Key</th><th>Conversation ID</th></> : null}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key}>
              <td>{edit === c.key ? <input className="inp" autoFocus defaultValue={c.name} aria-label={`New name for ${c.name}`} onKeyDown={(e) => { if (e.key === "Enter") save(c, e.currentTarget.value); if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }} onBlur={(e) => save(c, e.currentTarget.value)} />
                : <button type="button" className="link-k" title="Rename" onClick={() => setEdit(c.key)}>{c.name}</button>}</td>
              <td>{c.kind}</td><td>{when(c.last)}</td><td><Pips used={c.room} /></td><td>{c.status}</td><td>{c.goal}</td>
              {lv >= 2 ? <><td><code>{c.key}</code></td><td><code>{c.id}</code></td></> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <CallLine call={rename} />
    </>
  );
}

/* ---------- a settings section as JSON, with every field the schema has ---------- */
const isObj = (v: unknown): v is RecordValue => Boolean(v) && typeof v === "object" && !Array.isArray(v);
/** The JSON merge patch that turns `a` into `b` (removed keys become null); undefined when nothing changed. */
export function mergePatch(a: unknown, b: unknown): unknown {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (!isObj(a) || !isObj(b)) return b;
  const out: RecordValue = {};
  for (const k of Object.keys(a)) if (!(k in b)) out[k] = null;
  for (const [k, v] of Object.entries(b)) { const d = mergePatch(a[k], v); if (d !== undefined) out[k] = d; }
  return out;
}

export type Field = { path: string; type: string; label: string; help: string };
function typeOf(n: RecordValue, alt: unknown[] | null): string {
  if (Array.isArray(n.enum)) return n.enum.map(String).join(" | ");
  if (alt) return alt.map((v) => str(rec(v).const) || str(rec(v).type) || "value").join(" | ");
  return str(n.type) || "value";
}
/** Every leaf path of the engine's config schema, with its label and help. */
export function fieldsOf(schema: unknown, hints: RecordValue, p = "", out: Field[] = []): Field[] {
  const n = rec(schema);
  const props = rec(n.properties);
  if (Object.keys(props).length) { for (const [k, v] of Object.entries(props)) fieldsOf(v, hints, p ? `${p}.${k}` : k, out); return out; }
  const alt = Array.isArray(n.anyOf) ? n.anyOf : Array.isArray(n.oneOf) ? n.oneOf : null;
  const obj = alt?.find((v) => Object.keys(rec(rec(v).properties)).length);
  if (obj) return fieldsOf(obj, hints, p, out);
  const h = rec(hints[p]);
  out.push({ path: p, type: isObj(n.additionalProperties) ? "record" : typeOf(n, alt), label: str(h.label), help: str(h.help) });
  return out;
}
/** The schema's fields, read once per window (config.schema). */
export function useFields(engine: WindowEngine) {
  const res = useLive<RecordValue>(engine, "config.schema", {}, []);
  const fields = useMemo(() => (res.data ? fieldsOf(rec(res.data).schema, rec(rec(res.data).uiHints)) : []), [res.data]);
  return { fields, error: res.error, loading: res.loading && !res.data };
}

export function SectionDialog({ c, path, title, onClose }: { c: Ctx; path: string; title: string; onClose: () => void }) {
  const value = c.config.get(path);
  const [text, setText] = useState(JSON.stringify(value ?? {}, null, 2));
  const save = useCall();
  const { fields } = useFields(c.engine);
  const mine = fields.filter((f) => f.path === path || f.path.startsWith(`${path}.`));
  const go = () => void save.run(async () => {
    let next: unknown;
    try { next = JSON.parse(text); } catch (error) { throw new Error(`That isn’t valid JSON: ${errorText(error)}`); }
    const patch = mergePatch(value ?? {}, next);
    if (patch !== undefined) await configStore(c.engine).set(path as ConfigPath, patch);
    onClose();
  });
  return (
    <Dialog title={title} wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn pri disabled={save.busy} onClick={go}>Save</Btn></>}>
      <p className="hint s2advanced-gap"><code>{path}</code> · saved as you see it; a key you remove goes back to the engine’s default.</p>
      <textarea className="inp s2advanced-json" rows={16} spellCheck={false} aria-label={`${title} settings`} value={text} onChange={(e) => setText(e.target.value)} />
      <CallLine call={save} />
      {mine.length ? <details className="s2advanced-snap"><summary>Every field ({mine.length})</summary><FieldList fields={mine} config={c.config} /></details> : null}
    </Dialog>
  );
}

function FieldList({ fields, config }: { fields: Field[]; config: Ctx["config"] }) {
  const value = (p: string) => { const v = p.includes("*") ? undefined : config.get(p); return v === undefined ? "Default" : JSON.stringify(v).slice(0, 80); };
  return <dl className="s2advanced-fields">{fields.map((f) => <div key={f.path}><dt><b>{f.label || f.path.split(".").pop()}</b> <code>{f.path}</code></dt><dd>{value(f.path)}<small>{[f.type, f.help].filter(Boolean).join(" · ")}</small></dd></div>)}</dl>;
}

const OTHER: [string, string][] = [["Text to speech", "tts"], ["Attachments", "attachments"], ["Messages", "messages"], ["Talk", "talk"], ["Web", "tools.web"], ["Media", "tools.media"]];
/** A row whose title carries its config key: drawn like the kit's row, pin included. */
function KeyRow({ t, k, onEdit }: { t: string; k: string; onEdit: () => void }) {
  const pins = usePinsKit();
  const on = pins?.has(t) ?? false;
  return (
    <div className="ctl" data-row={t}>
      <b>{t} <code className="s2advanced-key">{k}</code></b>
      {pins ? <button type="button" className="pin-k" aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"} ${t}`} title={on ? "Unpin" : "Pin to the top of General"} onClick={() => pins.toggle(t)}><Icon name="pin" small /></button> : null}
      <span className="right"><Btn sm onClick={onEdit}>Edit</Btn></span>
    </div>
  );
}
/** Everything else (Technical): the sections with no page of their own, and a search over every setting. */
export function EverythingElse({ c }: { c: Ctx }) {
  const [open, setOpen] = useState<[string, string] | null>(null);
  const [q, setQ] = useState("");
  const { fields, error, loading } = useFields(c.engine);
  const hits = q.trim().length > 1 ? fields.filter((f) => `${f.path} ${f.label}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40) : [];
  return (
    <Sec title="Everything else" hint="Settings that have no page of their own. Every field shows, including the fine ones.">
      {OTHER.map(([t, k]) => <KeyRow key={k} t={t} k={k} onEdit={() => setOpen([t, k])} />)}
      <Ctl title="Find any setting" sub={error ?? (loading ? "Reading the engine’s settings list…" : `${fields.length} settings. Read only here; edit one in its section.`)} stack after={
        <div className="s2advanced-find">
          <input className="inp" placeholder="A setting’s name or path" aria-label="Find any setting" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.length ? <FieldList fields={hits} config={c.config} /> : q.trim().length > 1 && !loading ? <p className="hint">No setting matches.</p> : null}
        </div>
      } />
      {open ? <SectionDialog c={c} path={open[1]} title={open[0]} onClose={() => setOpen(null)} /> : null}
    </Sec>
  );
}

/* ---------- health readouts ---------- */
export function HealthDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const version = useBranchVersion(engine.gatewayUrl);
  const status = useLive<RecordValue>(engine, "status", {}, []);
  const health = useLive<RecordValue>(engine, "health", { probe: false }, []);
  const lanes = useLive<RecordValue>(engine, "diagnostics.lanes", {}, []);
  const stab = useLive<RecordValue>(engine, "diagnostics.stability", { limit: 25 }, []);
  const snaps: [string, { data?: unknown; error?: string }][] = [["Status", status], ["Health", health], ["Stability", stab]];
  return (
    <Dialog title="Health" wide onClose={onClose} footer={<><Btn ghost onClick={() => { void status.reload(); void health.reload(); void lanes.reload(); void stab.reload(); }}>Check again</Btn><Btn onClick={onClose}>Close</Btn></>}>
      <Kv rows={[["Branch version", version ? versionParts(version).detail : "Unavailable"], ["Process", str(rec(status.data).pid)], ["Health check", rec(health.data).ok === true ? `Answered ${when(rec(health.data).ts)}` : str(health.error)], ["Stability events", str(rec(stab.data).count)]]} />
      <h3 className="s2-h3">Snapshots</h3>
      {snaps.map(([t, r]) => <details key={t} className="s2advanced-snap"><summary>{t}</summary>{r.error ? <p className="hint s2-err">{r.error}</p> : <pre className="s2-pre">{JSON.stringify(r.data ?? null, null, 2)}</pre>}</details>)}
      <h3 className="s2-h3">Lanes</h3>
      <p className="hint">How much work each lane is doing and what is waiting.</p>
      {lanes.error ? <p className="hint s2-err">{lanes.error}</p> : (
        <div className="s2advanced-ctwrap"><table className="s2advanced-ct"><thead><tr><th>Lane</th><th>Active</th><th>Queued</th><th>At most</th><th>Group</th></tr></thead>
          <tbody>{list(rec(lanes.data).lanes).map((l) => <tr key={str(l.lane)}><td>{str(l.lane)}</td><td>{str(l.activeCount)}</td><td>{str(l.queuedCount)}</td><td>{str(l.maxConcurrent)}</td><td>{str(l.group)}</td></tr>)}</tbody></table></div>
      )}
    </Dialog>
  );
}

/* ---------- web search details ---------- */
export function WebSearchDialog({ engine, agent, onClose }: { engine: WindowEngine; agent: string; onClose: () => void }) {
  const st = useLive<RecordValue>(engine, "webSearch.status", agent ? { agentId: agent } : {}, []);
  const [q, setQ] = useState("");
  const test = useCall();
  const [result, setResult] = useState<RecordValue | null>(null);
  const d = rec(st.data);
  const route = rec(d.route);
  const tp = rec(d.testProvider);
  const run = () => void test.run(async () => setResult(rec(await engine.request("webSearch.test", { query: q.trim(), ...(agent ? { agentId: agent } : {}) }))));
  return (
    <Dialog title="Web search" wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <p className="hint s2advanced-gap">These apply to every Trunk.</p>
      {st.error ? <p className="hint s2-err" role="alert">{st.error}</p> : null}
      <h3 className="s2-h3">Which search each model uses</h3>
      <Kv rows={[["Model", d.model ? `${str(rec(d.model).provider)}/${str(rec(d.model).id)}` : ""], ["Search for this model", str(route.label)], ["Why", str(route.reason)]]} />
      <h3 className="s2-h3">Set up a search service</h3>
      <div className="rows">{list(d.providers).map((p) => <Prow key={str(p.id)} title={str(p.label)} sub={p.requiresCredential === true && p.credentialSource === "missing" ? "Key missing" : str(p.hint) || (p.requiresCredential === true ? "Key set" : "No key needed")}>{p.available === true ? <Pill tone="ok">Ready</Pill> : <Pill tone="warn">Needs setup</Pill>}</Prow>)}</div>
      <h3 className="s2-h3">Check it works</h3>
      <Hint>Settings alone don’t prove it works. Run a search to check.</Hint>
      <div className="s2advanced-logbar s2advanced-gap"><input className="inp" placeholder="What would you like to find?" aria-label="Search for" value={q} onChange={(e) => setQ(e.target.value)} /><Btn sm disabled={!q.trim() || test.busy || route.testable === false} title={route.testable === false ? str(route.reason) : undefined} onClick={run}>{`Test ${str(tp.label) || "search"}`}</Btn></div>
      <CallLine call={test} />
      {result ? <SearchResult r={result} /> : null}
    </Dialog>
  );
}
function SearchResult({ r }: { r: RecordValue }) {
  if (r.status === "error") return <p className="hint s2-err" role="alert">{str(r.error) || "The search failed."}</p>;
  return (
    <>
      <p className="hint">{`${str(r.provider)} answered in ${Math.round(Number(r.latencyMs) || 0)} ms${r.cached === true ? " (from the cache)" : ""}.`}</p>
      <div className="rows">{list(r.results).map((x, i) => <Prow key={i} title={str(x.title) || str(x.url)} sub={str(x.snippet) || str(x.url)} />)}</div>
      {r.content ? <pre className="s2-pre">{str(r.content)}</pre> : null}
    </>
  );
}

/* ---------- hooks ---------- */
const HOOK_EVENTS: [string, string[]][] = [
  ["Before a tool runs", []], ["After a tool runs", []], ["When a conversation starts", ["command:new", "command:reset", "agent:bootstrap"]],
  ["When you send a message", ["message", "message:received", "message:preprocessed", "message:transcribed"]], ["When a Trunk stops", ["command:stop"]],
  ["When a helper stops", []], ["Before tidying up", ["session:compact:before"]], ["When it needs you", []], ["When a task finishes", []],
  ["When a session ends", ["session:auto-reset"]], ["When settings change", ["session:patch"]], ["When a file changes", []],
];
const MAPPED = new Set(HOOK_EVENTS.flatMap(([, e]) => e));

export function HooksSec({ c }: { c: Ctx }) {
  const res = useLive<RecordValue>(c.engine, "hooks.status", c.agent ? { agentId: c.agent } : {}, ["config.changed", "plugins"]);
  const hooks = list(rec(res.data).hooks);
  const dir = str(rec(res.data).managedHooksDir);
  const names = (events: string[]) => hooks.filter((h) => (Array.isArray(h.events) ? h.events.map(String) : []).some((e) => events.includes(e) || events.some((x) => x.startsWith(`${e}:`))));
  const label = (h: RecordValue) => `${str(h.name)}${h.loadable === false ? ` (${str(h.blockedReason) || "off"})` : ""}`;
  const other = hooks.filter((h) => (Array.isArray(h.events) ? h.events.map(String) : []).some((e) => !MAPPED.has(e)));
  const add = dir ? `Hooks are folders with a HOOK.md; add one in ${dir}.` : "Hooks are folders with a HOOK.md in the hooks folder.";
  return (
    <Sec title="Hooks" hint="Your own scripts, run on these events. A script before a tool runs can stop it.">
      {res.error ? <p className="hint s2-err" role="alert">{res.error}</p> : null}
      <div className="rows">
        {HOOK_EVENTS.map(([t, events]) => {
          const found = events.length ? names(events) : [];
          return <Prow key={t} title={t} sub={found.length ? found.map(label).join(", ") : "No scripts"}><Btn sm disabled title={events.length ? add : "The engine has no hook for this event."}>Add a script</Btn></Prow>;
        })}
        {other.length ? <Prow title="Other engine events" sub={other.map((h) => `${label(h)} · ${(h.events as unknown[]).map(String).join(", ")}`).join("; ")} /> : null}
      </div>
      <Hint>{add} Branch reads them at the next start.</Hint>
    </Sec>
  );
}

/* ---------- other agents' memory ---------- */
export function MigrateDialog({ engine, agent, onClose }: { engine: WindowEngine; agent: string; onClose: () => void }) {
  const plan = useLive<RecordValue>(engine, "migrations.memory.plan", { agentId: agent }, []);
  const apply = useCall();
  const providers = list(rec(plan.data).providers).filter((p) => p.found === true);
  const bring = (p: RecordValue) => {
    const itemIds = list(p.items).filter((i) => i.status === "planned").map((i) => str(i.id));
    void apply.run(() => engine.request<RecordValue>("migrations.memory.apply", { idempotencyKey: crypto.randomUUID(), agentId: agent, providerId: str(p.providerId), planFingerprint: str(p.planFingerprint), itemIds }), (r) => { void plan.reload(); return `Brought in ${str(rec(rec(r).summary).migrated) || "0"} notes from ${str(p.label)}.`; });
  };
  return (
    <Dialog title="Other coding agents’ memory" wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <p className="hint s2advanced-gap">What other coding tools left on this computer, ready to copy into this Trunk’s memory. Nothing is copied until you choose.</p>
      {plan.error ? <p className="hint s2-err" role="alert">{plan.error}</p> : null}
      {plan.data && !providers.length ? <p className="hint">No other coding agent’s memory was found on this computer.</p> : null}
      <div className="rows">{providers.map((p) => {
        const s = rec(p.summary);
        const n = Number(s.planned) || 0;
        return <Prow key={str(p.providerId)} title={str(p.label)} sub={[str(p.source), `${n} to bring in`, Number(s.conflicts) ? `${str(s.conflicts)} conflicts` : ""].filter(Boolean).join(" · ")}><Btn sm disabled={!n || apply.busy || !p.planFingerprint} onClick={() => bring(p)}>Bring in</Btn></Prow>;
      })}</div>
      <CallLine call={apply} />
    </Dialog>
  );
}
