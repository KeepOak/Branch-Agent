// Library › Memory (preview 42-placesbp part 1 + 94-g4p): the characters card, Rings, search with its Trunk scope,
// the memory list with Forget, then the sections below (memory-more.tsx). Data: MEMORY.md through agents.files.*,
// memory.search, doctor.memory.*, config.get for the start-of-conversation limit.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { errorText, num, optStr, rec, recs, str, useOperation, useResource, type Trunk } from "./data";
import { configuredLimit, loadedChars, statedDefault, savedNotes, withoutFact, type Fact, type MemoryFile } from "./memory-data";
import { AboutYou, HoldForYes, HowItLearns, MemoryHealth, Pinned, statusOf, WhatToRemember, type MemoryStatus } from "./memory-more";
import { RingsRow } from "./rings";
import { EmptyIcon, Grey, IcoTile, LibIcon, plural, Row } from "./parts";
import { FileDialog } from "./reader";

export const TIDY_REASON = "Needs the engine’s memory tidy-up method.";

export type MemoryProps = {
  engine: WindowEngine; level: Level; trunks: Trunk[]; files: MemoryFile[] | null; reloadFiles: () => void;
  defaultId: string; openSettings?: (page: string) => void;
};

export function useMenu() {
  const [menu, setMenu] = useState<{ at: MenuAnchor; items: MenuItem[]; label: string } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const open = (event: MouseEvent<HTMLElement>, label: string, items: MenuItem[]) => {
    const r = event.currentTarget.getBoundingClientRect();
    setMenu(m => (m ? null : { at: { x: r.left, y: r.bottom + 4 }, items, label }));
  };
  return { open, element: menu && <Menu at={menu.at} items={menu.items} label={menu.label} onClose={close} /> };
}

export function MemoryTab(props: MemoryProps) {
  const { engine, level, trunks, files } = props;
  const [scope, setScope] = useState("");
  const [probe, setProbe] = useState(false);
  const scoped = files?.filter(f => !scope || f.agentId === scope) ?? null;
  const raw = useResource<unknown>(engine, "doctor.memory.status", { ...(scope ? { agentId: scope } : {}), ...(probe ? { probe: true } : {}) });
  const status = { ...raw, data: raw.data === null ? null : statusOf(raw.data) };
  // A Trunk's memory files or the memory index changed (the engine's agents.changed / memory.changed): show it now.
  const { reload } = raw;
  const { reloadFiles } = props;
  useEffect(() => engine.onEvent(({ event }) => {
    if (event === "memory.changed" || event === "agents.changed") { reload(); reloadFiles(); }
  }), [engine, reload, reloadFiles]);
  const check = () => { if (probe) status.reload(); else setProbe(true); };
  const scopeName = trunks.find(t => t.id === scope);
  return <div className="lib-mem">
    <MemoryCard {...props} scope={scope} files={scoped} status={status} check={check} />
    <RingsRow engine={engine} level={level} scope={scope} status={status} openSettings={props.openSettings} />
    <MemorySearch engine={engine} trunks={trunks} scope={scope} setScope={setScope} scopeName={scopeName ? scopeName.identity?.name || scopeName.name || scopeName.id : null} files={scoped} reloadFiles={props.reloadFiles} />
    {shows(level, "advanced") && <HowItLearns engine={engine} trunks={trunks} scope={scope || props.defaultId} onApplied={props.reloadFiles} />}
    <MemoryHealth engine={engine} agentId={scope || props.defaultId} status={status} check={check} />
    <WhatToRemember />
    <Pinned facts={scoped?.flatMap(f => f.facts) ?? []} />
    <AboutYou engine={engine} agentId={scope || props.defaultId} />
    {shows(level, "technical") && <HoldForYes />}
  </div>;
}

type CardProps = MemoryProps & { scope: string; status: { data: MemoryStatus | null; error: string | null }; check: () => void };

function MemoryCard({ engine, level, files, scope, status, check }: CardProps) {
  const config = useResource<unknown>(engine, "config.get");
  const own = config.data ? configuredLimit(config.data, scope || null) : null;
  const lookup = useResource<unknown>(engine, config.data && own === null ? "config.schema.lookup" : null, { path: "agents.defaults.bootstrapMaxChars" });
  const limit = own ?? (lookup.data ? statedDefault(lookup.data) : null);
  const menu = useMenu();
  if (!files) return <div className="lib-card" role="status"><p className="lib-hint">Loading…</p></div>;
  const failed = files.filter(f => f.error || f.notesError);
  const notes = files.reduce((n, f) => n + savedNotes(f).length, 0);
  const count = files.reduce((n, f) => n + f.facts.length, 0);
  const loaded = loadedChars(files, limit);
  const sizes = new Set(files.map(f => (f.file?.content ?? "").length));
  const fmt = (n: number) => new Intl.NumberFormat().format(n);
  const line = `${sizes.size > 1 ? "Up to " : ""}${fmt(loaded)}${limit ? ` of ${fmt(limit)}` : ""} characters load at the start of each conversation.`;
  const summary = [count ? plural(count, "memory", "memories") : "", notes ? plural(notes, "saved note", "saved notes") : ""].filter(Boolean).join(" · ") || "No saved memory notes";
  const s = status.data;
  return <div className="lib-card" data-testid="memory-card">
    <Ring part={loaded} whole={limit} label={line} />
    <div className="lib-grow">
      <b>{status.error || failed.length ? "Memory needs attention" : summary}</b>
      <p>{status.error ? status.error : failed.length ? "Some memory could not be read. Counts may be incomplete." : !loaded && notes ? "Saved notes are kept separately from the memory loaded at conversation start." : line}</p>
      {failed.map(f => <p key={f.agentId} className="lib-bad" role="alert">{f.trunk}: {f.error || f.notesError}</p>)}
      {shows(level, "advanced") && s && !status.error && <small className="lib-third">{engineName(s.provider)} · {s.embedding.ok ? "searches by meaning and words" : "searches by words only"}</small>}
    </div>
    <span className="lib-card-acts">
      <Grey label="Tidy up" reason={TIDY_REASON} />
      <button type="button" className="ib" aria-label="More for memory" aria-haspopup="menu" onClick={e => menu.open(e, "Memory", [{ label: "Check memory again", run: check }])}><LibIcon name="more" /></button>
    </span>
    {menu.element}
  </div>;
}

export function engineName(provider: string | undefined) {
  if (!provider || /^(builtin|built-in|sqlite|local|memory-core)$/i.test(provider)) return "Built-in memory";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function Ring({ part, whole, label }: { part: number; whole: number | null; label: string }) {
  const r = 14, c = 2 * Math.PI * r, share = whole ? Math.min(1, part / whole) : 0;
  return <span className={`lib-ring${share >= 0.9 ? " warn" : ""}`} role="img" aria-label={label}>
    <svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true"><circle cx="17" cy="17" r={r} className="lib-ring-bg" /><circle cx="17" cy="17" r={r} className="lib-ring-fg" strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 17 17)" /></svg>
  </span>;
}

type Hit = { path: string; snippet: string; startLine: number; endLine: number; score?: number; source?: string; agentId: string; trunk: string };

/** memory.search results that name a file; other fields read as empty. */
export function hitsOf(results: unknown): Omit<Hit, "agentId" | "trunk">[] {
  return recs(results).filter(h => typeof h.path === "string").map(h => ({ path: h.path as string, snippet: str(h.snippet), startLine: num(h.startLine) ?? 0, endLine: num(h.endLine) ?? 0, score: num(h.score), source: optStr(h.source) }));
}
type SearchProps = { engine: WindowEngine; trunks: Trunk[]; scope: string; setScope: (s: string) => void; scopeName: string | null; files: MemoryFile[] | null; reloadFiles: () => void };

function MemorySearch(props: SearchProps) {
  const { engine, trunks, scope, setScope, scopeName } = props;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ q: string; hits: Hit[]; mode: string; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const menu = useMenu();
  async function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) { setResult(null); return; }
    setBusy(true);
    const scopeTrunks = trunks.filter(t => !scope || t.id === scope);
    const answers = await Promise.all(scopeTrunks.map(t => engine.request<unknown>("memory.search", { agentId: t.id, query: q })
      .then(r => ({ t, r: rec(r), e: null as string | null }), e => ({ t, r: null, e: errorText(e) }))));
    const hits = answers.flatMap(a => hitsOf(a.r?.results).map(h => ({ ...h, agentId: a.t.id, trunk: a.t.identity?.name || a.t.name || a.t.id })));
    hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const mode = answers.some(a => a.r?.searchMode === "hybrid") ? "by meaning and words" : "by words only";
    setResult({ q, hits, mode, errors: answers.flatMap(a => (a.e ? [`${a.t.identity?.name || a.t.id}: ${a.e}`] : [])) });
    setBusy(false);
  }
  const scopeItems: MenuItem[] = [{ label: "Every Trunk", run: () => setScope("") }, { kind: "sep" }, ...trunks.map(t => ({ label: t.identity?.name || t.name || t.id, run: () => setScope(t.id) }))];
  return <div className="lib-search">
    <form className="lib-search-row" role="search" onSubmit={search}>
      <label className="lib-field"><LibIcon name="search" /><input aria-label="Search memory" type="search" placeholder={`Search what ${scopeName ?? "every Trunk"} remembers`} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button type="button" className="lib-chip" aria-haspopup="menu" aria-label="Whose memory" onClick={e => menu.open(e, "Whose memory", scopeItems)}>{scopeName ?? "Every Trunk"}</button>
    </form>
    {menu.element}
    {busy && <p className="lib-hint" role="status">Searching…</p>}
    {!result && !busy && <p className="lib-hint">Search for a person, a project, a decision or anything else it remembers.</p>}
    {result && !busy ? <SearchResults {...props} result={result} clear={() => { setResult(null); setQuery(""); }} /> : !result && <FactList {...props} />}
  </div>;
}

function SearchResults({ engine, result, clear }: SearchProps & { result: { q: string; hits: Hit[]; mode: string; errors: string[] }; clear: () => void }) {
  const [open, setOpen] = useState<Hit | null>(null);
  return <>
    <div className="lib-res-head"><small>{plural(result.hits.length, "result", "results")} · {result.mode}</small><button type="button" className="btn ghost sm" onClick={clear}>Clear</button></div>
    {result.errors.map(e => <p key={e} className="lib-bad" role="alert">{e}</p>)}
    {!result.hits.length ? <p className="lib-hint">Nothing remembered matches “{result.q}”.</p> : <div className="lib-rows">
      {result.hits.map((h, i) => <button type="button" key={h.agentId + h.path + i} className="lib-row lib-hit" onClick={() => setOpen(h)}>
        <IcoTile icon={h.source === "sessions" ? "learn" : "star"} />
        <span className="lib-grow"><b>{h.snippet.split("\n").find(l => l.trim())?.replace(/^[-*+#\s]+/, "") ?? h.path}</b><small>{h.trunk} · {h.path} · lines {h.startLine}–{h.endLine}</small></span>
      </button>)}
    </div>}
    {open && <FileDialog engine={engine} agentId={open.agentId} path={open.path} line={open.startLine} onClose={() => setOpen(null)} />}
  </>;
}

function FactList({ engine, files, reloadFiles }: SearchProps) {
  const op = useOperation(engine);
  const [open, setOpen] = useState<{ agentId: string; path: string } | null>(null);
  if (!files) return null;
  const facts = files.flatMap(f => f.facts.map(fact => ({ fact, file: f })));
  const notes = files.flatMap(f => savedNotes(f).map(note => ({ note, file: f })));
  if (!facts.length && !notes.length && !files.some(f => f.error || f.notesError)) return <EmptyLine icon={<EmptyIcon name="book" />}>Nothing remembered yet. Trunks write down what is worth keeping as they work, and anything you ask them to remember.</EmptyLine>;
  const forget = (fact: Fact, file: MemoryFile) => {
    if (!file.file?.hash) return;
    void op.run("agents.files.set", { agentId: fact.agentId, name: "MEMORY.md", content: withoutFact(file.file.content ?? "", fact), expectedHash: file.file.hash }, reloadFiles);
  };
  return <>
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
    <div className="lib-rows" data-testid="memory-list">
      {facts.map(({ fact, file }) => <Row key={fact.agentId + ":" + fact.start} icon="star" title={fact.text} line={`${fact.trunk} · ${fact.detail.replace(/^\((.*)\)$/, "$1") || "from MEMORY.md"}`}>
        <button type="button" className="btn ghost sm" disabled={op.busy || !file.file?.hash} title={file.file?.hash ? undefined : "The engine did not give this file’s revision, so it can’t be changed safely."} onClick={() => forget(fact, file)}>Forget</button>
      </Row>)}
      {notes.map(({ note, file }) => <Row key={file.agentId + ":" + note.path} icon="book" title={note.name} line={`${file.trunk} · ${note.path}`}>
        <button type="button" className="btn ghost sm" onClick={() => setOpen({ agentId: file.agentId, path: note.path })}>Open</button>
      </Row>)}
    </div>
    {open && <FileDialog engine={engine} agentId={open.agentId} path={open.path} onClose={() => setOpen(null)} />}
  </>;
}
