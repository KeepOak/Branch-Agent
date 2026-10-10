// Settings › Instructions & personality (DESIGN-SPEC §4.7.5): whose files (Every Trunk is the default Trunk's folder,
// then each Trunk's own), the files each Trunk reads with their line counts, the editor (agents.files.get / set with
// expectedHash or expectedMissing), Add a file… (BOOTSTRAP.md) at Advanced, Just about you, and the rows below.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsPageProps } from "../index";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Menu, type MenuAnchor } from "../../../shell/Menu";
import { Icon } from "../../../shell/icons";
import { Btn, Hint, Page, Status, Switch, useConfig, useLevel, useScope, type RowEntry } from "../kit";
import { FileEditor, lineCount, linesText, readFile, type FileState } from "./instructions-editor";
import { JustAboutYou } from "./instructions-you";
import { InstructionsMore } from "./instructions-more";
import "./set1.css";
import "./instructions.css";
import { fileTitle } from "./instructions-titles";
import { shownWhy } from "../../../shell/shown-why";

/** The preview's eight files, in its order. */
export const FILES: [string, string][] = [
  ["SOUL.md", "Who your assistant is: tone and boundaries"],
  ["IDENTITY.md", "Its name and how it introduces itself"],
  ["USER.md", "Who you are and what you prefer"],
  ["AGENTS.md", "House rules for every Trunk. Branch also reads CLAUDE.md and .hermes.md."],
  ["MEMORY.md", "Notes you wrote for it"],
];
const BOOTSTRAP: [string, string] = ["BOOTSTRAP.md", "Steps a new Trunk follows once, on its first run"];
/** The files agents.files.get / set accept (the engine's workspace bootstrap files). */
export const EDITABLE = new Set(["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md", "MEMORY.md"]);

type Trunk = { id: string; name: string };

export function InstructionsPage(props: SettingsPageProps) {
  const scope = useScope();
  const agents = useResource<RecordValue>(props.engine, "agents.list", {});
  const [pick, setPick] = useState<string | null>(scope);
  useEffect(() => setPick(scope), [scope]);
  const defaultId = agents.data?.defaultId ? text(agents.data.defaultId) : "";
  const trunks: Trunk[] = list(agents.data?.agents).map((a) => ({ id: text(a.id), name: visible(record(a.identity).name ?? a.name ?? a.id) }));
  const owner = pick ?? defaultId;
  const ownerName = owner === defaultId ? "every Trunk" : trunks.find((t) => t.id === owner)?.name ?? owner;
  return (
    <Page title={props.title} lede="Plain files every Trunk reads before it works." help="Plain files every Trunk reads before it works. They work the same as in other agents, so a file written for one of them works here.">
      {agents.error ? <Status tone="bad" title="Branch couldn’t read your Trunks">{visible(agents.error)}</Status> : null}
      {defaultId ? <Whose trunks={trunks} defaultId={defaultId} owner={owner} onPick={setPick} /> : null}
      {owner ? <OwnerFiles key={`files-${owner}`} engine={props.engine} agentId={owner} ownerName={ownerName} /> : null}
      <Hint>A file can’t widen what Branch may do; Permissions still decides.</Hint>
      {owner ? <JustAboutYou key={`you-${owner}`} engine={props.engine} agentId={owner} /> : null}
      <InstructionsMore engine={props.engine} />
    </Page>
  );
}

function Whose({ trunks, defaultId, owner, onPick }: { trunks: Trunk[]; defaultId: string; owner: string; onPick: (id: string) => void }) {
  const chips = [{ id: defaultId, name: "Every Trunk" }, ...trunks.filter((t) => t.id !== defaultId)];
  return (
    <div className="if-whose">
      <span className="if-lbl">Whose files</span>
      <div className="if-chips" role="group" aria-label="Whose files">
        {chips.map((c) => <button key={c.id} type="button" className="chip6" aria-pressed={owner === c.id} onClick={() => onPick(c.id)}>{c.name}</button>)}
      </div>
    </div>
  );
}

type Files = { loading: boolean; error?: string; listed: string[]; files: Record<string, FileState> };

/** The Trunk's folder: which files the engine lists, then each editable file's text (for its line count). */
function useAgentFiles(engine: WindowEngine, agentId: string) {
  const [state, setState] = useState<Files>({ loading: true, listed: [], files: {} });
  const gen = useRef(0);
  const load = useCallback(async () => {
    const mine = ++gen.current;
    try {
      const l = record(await engine.request("agents.files.list", { agentId }));
      const listed = list(l.files).map((f) => text(f.name));
      const names = [...EDITABLE].filter((n) => n !== BOOTSTRAP[0] || listed.includes(n));
      const got = await Promise.all(names.map((n) => readFile(engine, agentId, n).catch((e: unknown): FileState => ({ name: n, content: "", hash: null, missing: true, error: errorText(e) }))));
      if (mine === gen.current) setState({ loading: false, listed, files: Object.fromEntries(got.map((f) => [f.name, f])) });
    } catch (e) {
      if (mine === gen.current) setState((s) => ({ ...s, loading: false, error: errorText(e) }));
    }
  }, [engine, agentId]);
  useEffect(() => { void load(); return () => { gen.current++; }; }, [load]);
  return { ...state, reload: load };
}

function OwnerFiles({ engine, agentId, ownerName }: { engine: WindowEngine; agentId: string; ownerName: string }) {
  const lv = useLevel();
  const cfg = useConfig(engine);
  const files = useAgentFiles(engine, agentId);
  const [edit, setEdit] = useState<FileState | null>(null);
  const [saved, setSaved] = useState("");
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const injection = cfg.get(`agents.entries.${agentId}.contextInjection`) ?? cfg.get("agents.defaults.contextInjection");
  const boot = files.files[BOOTSTRAP[0]];
  const addable = lv >= 1 && boot?.missing === true && !boot.error;
  const rows = [...FILES, ...(boot && !boot.missing ? [BOOTSTRAP] : [])];
  const blank = (name: string): FileState => ({ name, content: "", hash: null, missing: true });
  if (files.error) return <Status tone="bad" title="Branch couldn’t read this Trunk’s files">{visible(files.error)}</Status>;
  return (
    <>
      {saved ? <p role="status">Saved · {saved}</p> : null}
      <div className="rows if-files" aria-busy={files.loading || undefined}>
        {rows.map(([name, what]) => <FileRow key={name} name={name} what={what} file={files.files[name]} loading={files.loading} never={injection === "never"} onOpen={() => { setSaved(""); setEdit(files.files[name] ?? blank(name)); }} />)}
      </div>
      {addable ? <div className="if-add" data-row="Add a file…"><Btn sm aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}><Icon name="plus" small />Add a file…</Btn></div> : null}
      {menu ? <Menu at={menu} label="Add a file" onClose={() => setMenu(null)} items={[{ label: `${fileTitle(BOOTSTRAP[0])} · ${BOOTSTRAP[1]}`, run: () => setEdit(boot ?? blank(BOOTSTRAP[0])) }]} /> : null}
      {edit ? <FileEditor engine={engine} agentId={agentId} file={edit} owner={ownerName} onClose={(saved) => { setEdit(null); if (saved) { setSaved(fileTitle(edit.name)); void files.reload(); } }} /> : null}
    </>
  );
}

type RowProps = { name: string; what: string; file?: FileState; loading: boolean; never: boolean; onOpen: () => void };
function FileRow({ name, what, file, loading, never, onOpen }: RowProps) {
  const editable = EDITABLE.has(name);
  const n = file ? lineCount(file.content) : 0;
  const boot = name === BOOTSTRAP[0];
  const sub = loading && !file ? "Reading…" : file?.error ? visible(file.error) : n ? `${linesText(n)}${boot ? " · cleared after the first run" : ""}` : "Empty";
  const why = editable ? undefined : `Branch can’t open ${fileTitle(name).toLowerCase()} here yet.`;
  const readWhy = why ?? (never ? "This Trunk is set to read none of these files." : n ? "Branch reads every file that has something in it." : "Branch reads it once something is written in it.");
  return (
    <div className={`prow if-row${why ? " off-k" : ""}`} data-row={what}>
      <span className="if-name" title={name}>{fileTitle(name)}</span>
      <span className="grow">
        <b>{what}</b><small>{sub}</small>
        {shownWhy(why) ? <small className="why-k">{shownWhy(why)}</small> : null}
      </span>
      {boot ? null : <span className="if-use" title={readWhy}><span>Use this file</span><Switch checked={n > 0 && !never} disabled label={`Use this file: ${fileTitle(name)}`} onChange={() => undefined} /><small>{readWhy}</small></span>}
      <Btn sm disabled={!editable || !file || Boolean(file.error)} onClick={onOpen}>{n ? "Edit" : "Write"}</Btn>
    </div>
  );
}

const rows = (sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "instructions", title, sec, group: sec.replace(/, (more|technical|in depth)$/, ""), lv }));
export const INSTRUCTIONS_ROWS: RowEntry[] = [
  ...rows("Whose files", 0, FILES.map(([, what]) => what)).map((r, i) => ({ ...r, words: FILES[i][0] })),
  ...rows("Whose files", 1, ["Add a file…"]).map((r) => ({ ...r, words: "BOOTSTRAP.md" })),
  ...rows("Just about you", 0, ["Just about you"]).map((r) => ({ ...r, words: "USER.md" })),
  ...rows("Project instructions", 0, ["Project instruction files"]),
  ...rows("Kits", 0, ["Pick a kit by what’s in the folder"]),
  ...rows("How replies are written", 0, ["Reply style"]),
];
