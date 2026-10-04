// Library › Documents (preview 40-places renderLibrary documents, 42-placesbp, 93-g3p tools-b17, 94-g4p secR418,
// trashR318): Work with documents, Write a new document, List / Map, the documents in every Trunk's project folder
// (agents.workspace.*), Managing what it reads [A], Test what it finds [A] (memory.search), Places it reads from [A],
// Recently deleted.
import { useEffect, useState, type FormEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { entriesOf, errorText, num, rec, trunkName, type FileEntry, type Trunk } from "./data";
import { hitsOf } from "./memory";
import { EmptyIcon, Grey, IcoTile, LibIcon, mapLimited, Row, Section, TypeBadge, when, type LibIconName } from "./parts";
import { FileDialog } from "./reader";
import { useCreateDocument } from "./create-document";

export const DOC_REASONS = {
  sheet: "Needs the engine’s spreadsheet question method.",
  compare: "Needs the engine’s compare-and-exact-edit method for documents.",
  map: "Needs an engine method that returns the documents’ topics and the links between them.",
  trash: "Needs the engine’s recently-deleted list for documents, with restore and delete for good.",
  kb: "Needs the engine’s knowledge-base management methods.",
  folder: "Needs the engine’s guided folder tour.",
  sources: "Needs the engine’s synced outside sources.",
  pages: "Needs the engine’s kept-answers pages.",
  connect: "Needs the engine’s connector for this source.",
};

/** Files the engine loads into every conversation; they live in Memory and Customize, not here. */
const CORE_FILES = /^(AGENTS|SOUL|IDENTITY|USER|BOOTSTRAP|MEMORY|HEARTBEAT|TOOLS)\.md$/i;
type Doc = FileEntry & { agentId: string; trunk: string; updatedAtMs?: number };
type Folder = { agentId: string; trunk: string; path: string };
type Listing = { docs: Doc[]; errors: string[]; more: { agentId: string; offset: number }[] };

async function listFolder(engine: WindowEngine, trunks: Trunk[], folder: Folder | null, offsets: Record<string, number>): Promise<Listing> {
  const inFolder = folder ? trunks.filter(t => t.id === folder.agentId) : trunks;
  // Load more asks only the Trunks that said they have more.
  const scope = Object.keys(offsets).length ? inFolder.filter(t => t.id in offsets) : inFolder;
  const answers = await mapLimited(scope, 4, t => engine.request<unknown>("agents.workspace.list", { agentId: t.id, path: folder?.path ?? "", offset: offsets[t.id] ?? 0 })
    .then(w => ({ t, w, e: null as string | null }), e => ({ t, w: null, e: errorText(e) })));
  const docs: Doc[] = [], errors: string[] = [], more: Listing["more"] = [];
  for (const { t, w, e } of answers) {
    if (e) { errors.push(`${trunkName(t)}: ${e}`); continue; }
    const listed = entriesOf(w);
    const entries = listed.filter(f => !f.name.startsWith(".") && (folder || !CORE_FILES.test(f.name)));
    docs.push(...entries.map(f => ({ ...f, agentId: t.id, trunk: trunkName(t) })));
    const seen = (num(rec(w).offset) ?? 0) + listed.length;
    const total = num(rec(w).totalEntries);
    if (listed.length && total !== undefined && seen < total) more.push({ agentId: t.id, offset: seen });
  }
  docs.sort((a, b) => (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) || (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  return { docs, errors, more };
}

function useDocuments(engine: WindowEngine, trunks: Trunk[], folder: Folder | null, revision: number) {
  const where = `${folder?.agentId ?? ""}|${folder?.path ?? ""}`;
  const ids = trunks.map(t => t.id).join(",");
  const [page, setPage] = useState<{ where: string; revision: number; offsets: Record<string, number> }>({ where, revision, offsets: {} });
  const offsetsKey = JSON.stringify(page.where === where && page.revision === revision ? page.offsets : {});
  const [state, setState] = useState<{ where: string; list: Listing | null; error: string | null }>({ where, list: null, error: null });
  useEffect(() => {
    let current = true;
    const offsets = JSON.parse(offsetsKey) as Record<string, number>;
    const appending = Object.keys(offsets).length > 0;
    void listFolder(engine, trunks, folder, offsets).then(
      next => { if (current) setState(s => ({ where, error: null, list: appending && s.where === where && s.list ? { ...next, docs: [...s.list.docs, ...next.docs] } : next })); },
      e => { if (current) setState({ where, list: null, error: errorText(e) }); });
    return () => { current = false; };
  }, [engine, ids, where, offsetsKey, revision]); // trunks and folder are read through ids and where
  const mine = state.where === where ? state : { list: null, error: null };
  const loadMore = () => setPage({ where, revision, offsets: Object.fromEntries((mine.list?.more ?? []).map(m => [m.agentId, m.offset])) });
  return { list: mine.list, error: mine.error, loadMore };
}

export function DocumentsTab({ engine, level, trunks, defaultId, mainKey }: { engine: WindowEngine; level: Level; trunks: Trunk[]; defaultId?: string; mainKey?: string }) {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [revision, setRevision] = useState(0);
  const docs = useDocuments(engine, trunks, folder, revision);
  const creation = useCreateDocument({ engine, trunks, defaultId, mainKey, location: `${folder?.agentId ?? ""}|${folder?.path ?? ""}`, onCreated: (document, trunk) => {
    setFolder({ agentId: document.agentId, trunk, path: document.file.path.slice(0, document.file.path.lastIndexOf("/")) });
    setRevision(value => value + 1);
  } });
  const files = docs.list?.docs.filter(d => d.kind !== "directory") ?? [];
  return <div className="lib-docs">
    <DocumentTools trunks={trunks} creation={creation} />
    {creation.error && <p className="lib-bad" role="alert">{creation.error}</p>}
    {creation.note && <p className="lib-hint" role="status">{creation.note}</p>}
    {folder && <button type="button" className="link lib-up" onClick={() => setFolder(null)}>‹ Documents</button>}
    {folder && <p className="lib-hint">{folder.trunk} · {folder.path}</p>}
    {docs.error && <p className="lib-bad" role="alert">{docs.error}</p>}
    {docs.list?.errors.map(e => <p key={e} className="lib-bad" role="alert">{e}</p>)}
    {!docs.list && !docs.error && <p className="lib-hint" role="status">Loading…</p>}
    {docs.list && !docs.list.docs.length && !docs.list.errors.length && <EmptyLine icon={<EmptyIcon name="file" />}>{folder ? "No documents." : "No documents yet. Trunks add what they read here; you can write one too."}</EmptyLine>}
    <div className="lib-plain" data-testid="document-list">
      {docs.list?.docs.map(d => <Row key={d.agentId + ":" + d.path} badge={d.kind === "directory" ? <IcoTile icon="folder" /> : <TypeBadge name={d.name} />} title={d.name}
        line={[d.trunk, d.kind === "directory" ? "folder" : when(d.updatedAtMs)].filter(Boolean).join(" · ")}>
        <button type="button" className="btn sm" onClick={() => (d.kind === "directory" ? setFolder({ agentId: d.agentId, trunk: d.trunk, path: d.path }) : setOpen(d))}>Open</button>
      </Row>)}
    </div>
    {!!docs.list?.more.length && <button type="button" className="btn ghost sm" onClick={docs.loadMore}>Load more</button>}
    {shows(level, "advanced") && <Managing />}
    {shows(level, "advanced") && <TestWhatItFinds engine={engine} trunks={trunks} files={files} />}
    {shows(level, "advanced") && <PlacesItReads />}
    <Section title="Recently deleted" testid="recently-deleted"><p className="lib-hint">{DOC_REASONS.trash}</p></Section>
    {open && <FileDialog engine={engine} agentId={open.agentId} path={open.path} onClose={() => setOpen(null)} />}
  </div>;
}

function DocumentTools({ trunks, creation }: { trunks: Trunk[]; creation: ReturnType<typeof useCreateDocument> }) {
  return <>
    <Section title="Work with documents"><div className="lib-tools">
      <ToolTile icon="sheet" title="Ask a spreadsheet" line="Questions in plain words or SQL, answered with a table and a chart. Read only." reason={DOC_REASONS.sheet} />
      <ToolTile icon="diff" title="Compare or edit exactly" line="What changed between two versions, and edits that leave every other byte as it was." reason={DOC_REASONS.compare} />
    </div></Section>
    <div className="lib-docacts">
      <button type="button" className="btn" disabled={creation.busy || !!creation.reason} title={creation.reason || undefined} onClick={() => void creation.create()}><LibIcon name="file" />Write a new document</button>
      <select className="inp" aria-label="Trunk for new document" value={creation.selected} onChange={event => creation.choose(event.target.value)}>
        {!trunks.some(t => t.id === creation.selected) && <option value="">Choose a Trunk…</option>}
        {trunks.map(t => <option key={t.id} value={t.id}>{trunkName(t)}</option>)}
      </select>
      <div className="lib-seg" role="radiogroup" aria-label="Documents view">
        <button type="button" role="radio" aria-checked="true"><LibIcon name="list" size={13} />List</button>
        <button type="button" role="radio" aria-checked="false" disabled title={DOC_REASONS.map} data-reason={DOC_REASONS.map}><LibIcon name="map" size={13} />Map</button>
      </div>
    </div>
  </>;
}

function ToolTile({ icon, title, line, reason }: { icon: LibIconName; title: string; line: string; reason: string }) {
  return <button type="button" className="lib-tool" disabled title={reason} data-reason={reason}><IcoTile icon={icon} /><span className="lib-grow"><b>{title}</b><small>{line}</small></span></button>;
}

function Managing() {
  const rows: [LibIconName, string, string, string, string][] = [
    ["folder", "Knowledge bases", "Folders it reads, kept as quotable passages. Rename, merge, split and choose how long they stay.", "Manage", DOC_REASONS.kb],
    ["box", "Understand a folder", "A map of a folder, then a short guided tour of what’s in it.", "Try a folder", DOC_REASONS.folder],
    ["repeat", "Bring things in from other services", "Keeps a copy of chosen items from Drive, Notion or a notes vault, in sync.", "See sources", DOC_REASONS.sources],
    ["book", "Kept answers and long articles", "An answer you like becomes a page you can reopen; a long article is written section by section.", "See pages", DOC_REASONS.pages],
  ];
  return <Section title="Managing what it reads" testid="managing"><div className="lib-plain">
    {rows.map(([icon, title, line, label, reason]) => <Row key={title} icon={icon} title={title} line={line}><Grey label={label} reason={reason} /></Row>)}
  </div></Section>;
}

type Passage = { path: string; snippet: string; startLine: number; endLine: number; score?: number; trunk: string; agentId: string };

function fileKey(agentId: string, path: string) { return JSON.stringify([agentId, path]); }

function TestWhatItFinds({ engine, trunks, files }: { engine: WindowEngine; trunks: Trunk[]; files: Doc[] }) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<string[]>([]);
  const [found, setFound] = useState<{ passages: Passage[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function find(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    const answers = await mapLimited(trunks, 4, t => engine.request<unknown>("memory.search", { agentId: t.id, query: query.trim() })
      .then(r => ({ t, r, e: null as string | null }), err => ({ t, r: null, e: errorText(err) })));
    const passages = answers.flatMap(a => hitsOf(rec(a.r).results).map(p => ({ ...p, trunk: trunkName(a.t), agentId: a.t.id }))).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    setFound({ passages, errors: answers.flatMap(a => (a.e ? [`${trunkName(a.t)}: ${a.e}`] : [])) });
    setBusy(false);
  }
  const chosen = only.filter(key => files.some(f => fileKey(f.agentId, f.path) === key));
  const shown = found?.passages.filter(p => !chosen.length || chosen.includes(fileKey(p.agentId, p.path))) ?? [];
  return <Section title="Test what it finds" hint="The passages a Trunk would be given for a question." testid="test-finds">
    <form className="lib-form" onSubmit={find}><input className="inp" aria-label="A question to test" placeholder="who fixes the boiler?" value={query} onChange={e => setQuery(e.target.value)} /><button type="submit" className="btn sm" disabled={busy || !query.trim()}>Find</button></form>
    {!!files.length && <div className="lib-only"><span>Only these files:</span>{files.map(f => {
      const key = fileKey(f.agentId, f.path);
      const duplicate = files.some(other => other !== f && other.name === f.name);
      return <label key={key} className="lib-chk"><input type="checkbox" checked={chosen.includes(key)} onChange={e => setOnly(o => (e.target.checked ? [...o, key] : o.filter(x => x !== key)))} />{f.name}{duplicate ? ` · ${f.trunk}` : ""}</label>;
    })}</div>}
    {busy && <p className="lib-hint" role="status">Finding…</p>}
    {found?.errors.map(e => <p key={e} className="lib-bad" role="alert">{e}</p>)}
    {found && !busy && (shown.length ? <div className="lib-plain">{shown.map((p, i) => <Row key={p.path + i} icon="file" title={`${p.path} · lines ${p.startLine}–${p.endLine}`} line={`${p.trunk}${p.score !== undefined ? ` · score ${p.score.toFixed(2)}` : ""} · ${p.snippet}`} />)}</div>
      : <p className="lib-hint">No passages found for that question.</p>)}
  </Section>;
}

function PlacesItReads() {
  const rows: [LibIconName, string, string][] = [
    ["book", "A documentation site", "Reads a whole docs site so you can ask with @docs."],
    ["code", "A code repository", "GitHub, GitLab or Gitea, one branch and the folders you pick."],
    ["file", "Confluence", "Spaces and pages you choose."],
    ["file", "Paperless-ngx", "Your scanned paperwork, kept in sync."],
    ["file", "DrupalWiki", "Pages from your wiki."],
    ["file", "Org files", "Headings, tags and dates from .org outlines."],
    ["cloud", "A knowledge base in your cloud", "Searches one you already run, without copying it."],
  ];
  return <Section title="Places it reads from" testid="places-it-reads"><div className="lib-plain">
    <Row icon="globe" title="A web page or video" line="Reads the page, or a video’s captions, safely." />
    <div className="lib-form lib-form-row"><input className="inp" disabled placeholder="https://… or a video link" aria-label="A web page or video link" title={DOC_REASONS.connect} /><Grey label="Add" reason={DOC_REASONS.connect} /></div>
    {rows.map(([icon, title, line]) => <Row key={title} icon={icon} title={title} line={line}><Grey ghost label="Connect" reason={DOC_REASONS.connect} /></Row>)}
  </div></Section>;
}
