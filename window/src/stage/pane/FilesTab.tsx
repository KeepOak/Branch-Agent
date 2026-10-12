import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { SIcon } from "../stage-icons";

type FileEntry = { path: string; name: string; kind?: "modified" | "read"; missing?: boolean; content?: string; contentEncoding?: string; hash?: string; previewKind?: string };
type BrowseEntry = { path: string; name: string; kind: "file" | "directory"; sessionKind?: "modified" | "read" | "mixed" };
type Listing = { files: FileEntry[]; root?: string; entries: BrowseEntry[]; truncated?: boolean };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KIND: Record<string, string> = { modified: "Changed", read: "Read", mixed: "Changed" };
const NO_MADE = "The engine marks files as changed or read; it doesn't keep which ones it made.";

async function list(engine: WindowEngine, params: { path?: string; search?: string }): Promise<Listing> {
  const r = rec(await engine.request("sessions.files.list", { sessionKey: engine.sessionKey, ...params }));
  const browser = rec(r.browser);
  return {
    files: Array.isArray(r.files) ? (r.files as FileEntry[]) : [],
    root: typeof r.root === "string" ? r.root : undefined,
    entries: Array.isArray(browser.entries) ? (browser.entries as BrowseEntry[]) : [],
    truncated: browser.truncated === true,
  };
}

function Folder({ engine, entry, depth, onOpen }: { engine: WindowEngine; entry: BrowseEntry; depth: number; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<BrowseEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setKids(null); setError("");
    list(engine, { path: entry.path }).then(
      (l) => { if (live) setKids(l.entries); },
      (e: unknown) => { if (live) setError(errorText(e)); },
    );
    return () => { live = false; };
  }, [engine, entry.path, open]);
  return (
    <>
      <button type="button" className="ft-row-pn" role="treeitem" aria-level={depth + 1} aria-expanded={open} style={{ "--lv": depth } as React.CSSProperties} onClick={() => setOpen((v) => !v)}>
        <SIcon name="chev" small className="ft-chev-pn" />
        <SIcon name="folder" small />
        <span className="grow">{entry.name}</span>
        {entry.sessionKind ? <i className="ft-dot-pn" aria-label="Holds a file it touched" /> : null}
      </button>
      {open ? (
        error ? (
          <p className="err-st" role="alert">{error}</p>
        ) : !kids ? (
          <p className="hint-st" role="status" style={{ paddingLeft: 8 + (depth + 1) * 21 }}>Reading…</p>
        ) : kids.length ? (
          <div role="group" aria-label={entry.name}>{kids.map((k) => <Entry key={k.path} engine={engine} entry={k} depth={depth + 1} onOpen={onOpen} />)}</div>
        ) : (
          <p className="hint-st" style={{ paddingLeft: 8 + (depth + 1) * 21 }}>This folder is empty.</p>
        )
      ) : null}
    </>
  );
}

function Entry({ engine, entry, depth, onOpen }: { engine: WindowEngine; entry: BrowseEntry; depth: number; onOpen: (path: string) => void }) {
  if (entry.kind === "directory") return <Folder engine={engine} entry={entry} depth={depth} onOpen={onOpen} />;
  return (
    <button type="button" className="ft-row-pn" role="treeitem" aria-level={depth + 1} style={{ "--lv": depth } as React.CSSProperties} onClick={() => onOpen(entry.path)}>
      <span className="ft-sp-pn" />
      <SIcon name="file" small />
      <span className="grow">{entry.name}</span>
      {entry.sessionKind ? <span className="pill idle">{KIND[entry.sessionKind]}</span> : null}
    </button>
  );
}

/** One file: its text, editable and saved back with sessions.files.set (only if nobody changed it meanwhile). */
function FileView({ engine, path, onClose }: { engine: WindowEngine; path: string; onClose: () => void }) {
  const [loadedFile, setFile] = useState<FileEntry | null>(null);
  const owner = useRef({ engine, path, sessionKey: engine.sessionKey, live: false });
  const file = owner.current.engine === engine && owner.current.path === path && owner.current.sessionKey === engine.sessionKey ? loadedFile : null;
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [state, setState] = useState<{ error?: string; saved?: boolean; busy?: boolean }>({});
  useEffect(() => {
    const current = { engine, path, sessionKey: engine.sessionKey, live: true };
    owner.current = current;
    setFile(null); setDraft(null); setState({});
    engine.request<{ file: FileEntry }>("sessions.files.get", { sessionKey: engine.sessionKey, path }).then(
      (r) => current.live && setFile(r.file),
      (e: unknown) => current.live && setState({ error: errorText(e) }),
    );
    return () => {
      current.live = false;
    };
  }, [engine, engine.sessionKey, path]);
  const text = file && file.contentEncoding !== "base64" && file.previewKind !== "image" && file.previewKind !== "unsupported" ? file.content ?? null : null;
  const save = () => {
    if (draft === null || !file?.hash) return;
    const current = owner.current;
    if (!current.live || current.engine !== engine || current.path !== path || current.sessionKey !== engine.sessionKey) return;
    const sent = draft;
    setState({ busy: true });
    engine.request<{ file: FileEntry }>("sessions.files.set", { sessionKey: engine.sessionKey, path, content: draft, expectedHash: file.hash }).then(
      (r) => {
        if (!current.live) return;
        setFile(r.file);
        setDraft((current) => current === sent ? null : current);
        setState({ saved: draftRef.current === sent });
      },
      (e: unknown) => { if (current.live) setState({ error: errorText(e) }); },
    );
  };
  return (
    <section className="file-view-pn" aria-label={file?.name ?? path}>
      <header>
        <SIcon name="file" small />
        <b>{file?.name ?? path.split("/").pop()}</b>
        {text !== null && file?.hash ? (
          draft === null ? (
            <button type="button" className="btn ghost sm" onClick={() => setDraft(text)}>
              Edit
            </button>
          ) : (
            <>
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>
                Undo
              </button>
              <button type="button" className="btn pri sm" disabled={state.busy || draft === text} onClick={save}>
                Keep
              </button>
            </>
          )
        ) : null}
        <button type="button" className="ib sm" aria-label="Close the file" onClick={onClose}>
          <SIcon name="x" small />
        </button>
      </header>
      <small className="hint-st">{path}</small>
      {state.error ? <p className="err-st" role="alert">{state.error}</p> : null}
      {state.saved ? <p className="hint-st ok-st">Saved.</p> : null}
      {!file && !state.error ? <p className="hint-st">Reading…</p> : null}
      {file && text === null ? <p className="pane-empty">This file has no text preview.</p> : null}
      {text !== null ? draft === null ? <pre className="file-pre-pn">{text}</pre> : <textarea className="file-edit-pn" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label={`Change ${file?.name ?? path}`} /> : null}
    </section>
  );
}

/** Files: search, the files it touched (changed or read) and the workspace as a tree. */
export function FilesTab({ engine }: { engine: WindowEngine }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [only, setOnly] = useState<"modified" | "read" | null>(null);
  const [touchedOnly, setTouchedOnly] = useState(false);
  const [data, setData] = useState<{ key: string; listing?: Listing; error?: string }>({ key: "" });
  const [open, setOpen] = useState<string | null>(null);
  const key = `${engine.sessionKey}|${submitted}`;
  useEffect(() => {
    let live = true;
    list(engine, submitted ? { search: submitted } : {}).then(
      (listing) => live && setData({ key, listing }),
      (e: unknown) => live && setData({ key, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [engine, submitted, key]);
  useEffect(() => {
    const t = setTimeout(() => setSubmitted(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const current = data.key === key ? data : { key, listing: undefined, error: undefined };
  const listing = current.listing;
  const touched = (listing?.files ?? []).filter((f) => !only || f.kind === only);
  const entries = (listing?.entries ?? []).filter((e) => !touchedOnly || e.sessionKind);
  if (open) return <FileView engine={engine} path={open} onClose={() => setOpen(null)} />;
  return (
    <>
      <div className="f-search-pn">
        <input className="inp" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files" />
        <span className="chips-pn" role="group" aria-label="Which files are listed">
          {(["modified", "read"] as const).map((k) => (
            <button key={k} type="button" className="chip-pn" aria-pressed={only === k} onClick={() => setOnly(only === k ? null : k)}>
              {KIND[k]}
            </button>
          ))}
          <button type="button" className="chip-pn" aria-pressed={false} disabled title={NO_MADE}>
            Made
          </button>
        </span>
      </div>
      {current.error ? <p className="err-st" role="alert">{current.error}</p> : null}
      {!listing && !current.error ? <p className="pane-empty">Reading this conversation's files…</p> : null}
      {listing && !listing.root && !listing.files.length ? <p className="pane-empty">This conversation doesn't work in a folder.</p> : null}
      {touched.map((f) => (
        <button key={f.path} type="button" className="memrow-pn file-card-pn" disabled={f.missing} onClick={() => setOpen(f.path)}>
          <span>
            <b>{f.name}</b>
          </span>
          <small>{f.missing ? "Missing now" : f.path}</small>
          {f.kind ? <span className="pill idle">{KIND[f.kind]}</span> : null}
        </button>
      ))}
      {listing && listing.files.length ? (
        <p className="ft-line-pn">
          {listing.files.length} touched in this task ·{" "}
          <button type="button" className="link" aria-pressed={touchedOnly} onClick={() => setTouchedOnly((v) => !v)}>
            {touchedOnly ? "Show everything" : "Show only these"}
          </button>
        </p>
      ) : null}
      {listing?.root ? (
        <>
          <div className="ph ft-lab-pn">Workspace · {listing.root.split(/[\\/]/).filter(Boolean).pop()}</div>
          <div className="ft-tree-pn" role="tree" aria-label="Workspace">
            {entries.length ? entries.map((e) => <Entry key={e.path} engine={engine} entry={e} depth={0} onOpen={setOpen} />) : <p className="pane-empty">{submitted ? "No files match." : "This folder is empty."}</p>}
            {listing.truncated ? <p className="hint-st">Showing the first part of this folder.</p> : null}
          </div>
        </>
      ) : null}
    </>
  );
}
