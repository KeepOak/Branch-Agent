import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { WindowEngine } from "../connect/engine";
import { SettingsPage, SETTINGS_ROWS } from "../places/settings";
import { KitProvider, SetupLock, type Lv, type SaveReport } from "../places/settings/kit";
import { configStore } from "../places/settings/config-store";
import { errorText, list, record, text, visible, type RecordValue } from "../places/settings/adapter";
import { useResource } from "../places/settings/hooks";
import { usePins, type Pin } from "../places/settings/pins";
import { CharacterFace } from "../face/CharacterFace";
import { Face } from "../face/Face";
import { trunkAppearance } from "../face/appearance";
import { Icon } from "../shell/icons";
import { LEVEL_LINES, levelFor, pageAtLevel, pageName, searchSettings, settingsGroups, type Level, type SearchRow } from "./settings-nav";
import "./settings-frame.css";

const LEVEL_KEY = "branch.level";
const LEVELS: { id: Level; name: string }[] = [
  { id: "regular", name: "Regular" },
  { id: "advanced", name: "Advanced" },
  { id: "technical", name: "Technical" },
];
const LV: Record<Level, Lv> = { regular: 0, advanced: 1, technical: 2 };
/** Not allowed to change setup (§4.7.0): these pages' rows grey; these pages leave the nav. config.patch needs operator.admin. */
const SETUP_PAGES = ["general", "models", "local", "accounts", "chatapps", "permissions", "computer", "usage", "seasons", "updates", "advanced", "developer"];
const HIDDEN_PAGES = ["secrets", "gateway", "self"];

export function readLevel(): Level {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    return v === "advanced" || v === "technical" ? v : "regular";
  } catch {
    return "regular"; // storage blocked: Regular, the default for a new person
  }
}

function saveLevel(level: Level): void {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // storage blocked: the level lasts for this window only
  }
}

type Props = {
  page: string;
  backName: string;
  engine: WindowEngine;
  onPage: (page: string) => void;
  onBack: () => void;
  /** Starts a conversation with the default Trunk ("Learn more"); absent while no model is set up. */
  onAsk?: (text: string) => void;
  askName?: string;
};

/** The segmented "How much to show" control (§4.7.0, §5.2): Left and Right move the choice. */
function LevelControl({ level, onLevel }: { level: Level; onLevel: (l: Level) => void }) {
  const index = LEVELS.findIndex((l) => l.id === level);
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const next = e.key === "Home" ? 0 : e.key === "End" ? LEVELS.length - 1 : step ? (index + step + LEVELS.length) % LEVELS.length : -1;
    if (next >= 0) {
      e.preventDefault();
      e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      onLevel(LEVELS[next].id);
    }
  };
  return (
    <div className="set-level">
      <span className="set-level-label">How much to show</span>
      <div className="seg" role="radiogroup" aria-label="How much to show" style={{ ["--i" as string]: index }} onKeyDown={onKey}>
        {LEVELS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={l.id === level} tabIndex={l.id === level ? 0 : -1} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" title={LEVEL_LINES[l.id]} data-level={l.id} onClick={() => onLevel(l.id)}>
            {l.name}
          </button>
        ))}
      </div>
      <small className="set-level-line">{LEVEL_LINES[level]}</small>
    </div>
  );
}

type SaveState = { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string } | null;
/** The save-state line (§4.7.0): "Saving…", then "Saved" with a check for 2 s, or what went wrong until the next change. */
function useSaveState(): [SaveState, SaveReport] {
  const [state, setState] = useState<SaveState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const report = useMemo<SaveReport>(() => ({
    saving: () => { clearTimeout(timer.current); setState({ kind: "saving" }); },
    saved: () => { clearTimeout(timer.current); setState({ kind: "saved" }); timer.current = setTimeout(() => setState(null), 2000); },
    failed: (message) => { clearTimeout(timer.current); setState({ kind: "failed", message }); },
  }), []);
  return [state, report];
}

function SaveLine({ state }: { state: SaveState }) {
  return (
    <p className={`set-save${state?.kind === "failed" ? " bad" : ""}`} role="status" aria-live="polite" hidden={!state}>
      {state?.kind === "saved" ? <><Icon name="check" small />Saved</> : state?.kind === "saving" ? "Saving…" : state?.kind === "failed" ? `Not saved: ${visible(state.message)}` : null}
    </p>
  );
}

/** A Trunk's still face, small: its character when it has one, else the flat pebble. */
function TrunkFace({ trunk, size }: { trunk: RecordValue; size: number }) {
  const name = text(record(trunk.identity).name ?? trunk.name ?? trunk.id);
  const look = trunkAppearance(typeof record(trunk.identity).avatar === "string" ? String(record(trunk.identity).avatar) : undefined, name);
  return look ? <CharacterFace appearance={look} size={size} label={name} /> : <Face size={size} label={name} />;
}

/** "Settings for" (Advanced): which Trunk's own settings the pages show; the default Trunk first. */
function ScopePicker({ engine, scope, onScope }: { engine: WindowEngine; scope: string | null; onScope: (id: string | null) => void }) {
  const agents = useResource<RecordValue>(engine, "agents.list", {});
  const def = text(agents.data?.defaultId ?? "");
  const all = list(agents.data?.agents);
  const trunks = [...all.filter((t) => t.id === def), ...all.filter((t) => t.id !== def)];
  const cur = trunks.find((t) => t.id === (scope ?? def)) ?? trunks[0];
  return (
    <label className="set-scope">
      <span>Settings for</span>
      <span className="set-scope-r">
        {cur ? <TrunkFace trunk={cur} size={20} /> : null}
        <select className="inp" aria-label="Settings for" value={text(cur?.id ?? "")} disabled={trunks.length < 2} onChange={(e) => onScope(e.target.value === def ? null : e.target.value)}>
          {trunks.map((t) => <option key={text(t.id)} value={text(t.id)}>{visible(record(t.identity).name ?? t.name ?? t.id)}</option>)}
        </select>
      </span>
    </label>
  );
}

/** Search results in the nav: matching pages and, under each, its matching rows; a level tag where it's above yours. */
function SearchResults({ query, level, shown, onGo }: { query: string; level: Level; shown: string; onGo: (page: string, row?: SearchRow) => void }) {
  const groups = searchSettings(query, SETTINGS_ROWS);
  if (!groups.length) return <p className="set-nomatch">No setting matches.</p>;
  const tag = (lv: number) => (lv > LV[level] ? <span className="set-lvtag">{lv === 2 ? "Technical" : "Advanced"}</span> : null);
  return (
    <>
      {groups.map((g) => (
        <div key={g.name} className="set-group">
          <div className="grp">{g.name}</div>
          {g.hits.map(({ page, rows }) => (
            <div key={page.id} className="set-hit">
              <button type="button" className="set-item" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" data-page={page.id} aria-current={page.id === shown ? "true" : undefined} onClick={() => onGo(page.id)}>{page.name}{tag(page.lv)}</button>
              {rows.map((r) => (
                <button key={r.title} type="button" className="set-item set-row" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" data-row-hit={r.title} onClick={() => onGo(page.id, r)}>
                  <span className="grow"><span>{r.title}</span><small>{r.group}</small></span>{tag(r.lv)}
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** The settings-file problem box: the engine read a settings file it can't use, so nothing here can be saved. */
function FileProblem({ engine }: { engine: WindowEngine }) {
  const store = configStore(engine);
  const [snap, setSnap] = useState(store.snap);
  useEffect(() => { const off = store.subscribe(() => setSnap(store.snap)); if (!store.snap) void store.load(); return () => { off(); }; }, [store]);
  if (snap?.valid !== false) return null;
  const issues = list(snap.issues).map((i) => visible(i.message ?? i.path ?? JSON.stringify(i)));
  return (
    <div className="status set-fileproblem" role="alert">
      <span className="sdot bad" />
      <div className="grow">
        <b>The settings file has a problem</b>
        <p>Branch keeps running on the last good settings. Changes here can’t be saved until the file is fixed.</p>
        {issues.length ? <ul>{issues.slice(0, 5).map((i) => <li key={i}>{i}</li>)}</ul> : null}
      </div>
    </div>
  );
}

/** Scrolls to a row found by search, highlights it and focuses its control (§4.7.0 "jump and highlight"). */
function useRowJump(page: string) {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    const find = () => {
      const row = [...document.querySelectorAll<HTMLElement>(".set-col [data-row]")].find((r) => r.dataset.row === target)
        ?? [...document.querySelectorAll<HTMLElement>(".set-col [data-sec]")].find((r) => r.dataset.sec === target);
      if (!row) { if (++tries < 20) handle = window.setTimeout(find, 100); return; }
      row.scrollIntoView({ block: "center" });
      row.classList.remove("hit-k"); void row.offsetWidth; row.classList.add("hit-k");
      row.querySelector<HTMLElement>("input, select, button:not(.pin-k), textarea")?.focus({ preventScroll: true }); // the row's control, not its pin
      setTarget(null);
    };
    let handle = window.setTimeout(find, 0);
    return () => window.clearTimeout(handle);
  }, [target, page]);
  return setTarget;
}

/** The Settings frame (DESIGN-SPEC §4.7.0): the nav column with Back, search, "Settings for", page items, the save
 *  state and the level; one page on the right. */
export function SettingsFrame({ page, backName, engine, onPage, onBack, onAsk, askName }: Props) {
  const [chosen, setLevel] = useState<Level>(readLevel);
  const level = levelFor(page, chosen); // opening a page this level hides raises the level
  useEffect(() => {
    if (level !== chosen) {
      setLevel(level);
      saveLevel(level);
    }
  }, [level, chosen]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  const [save, report] = useSaveState();
  const jump = useRowJump(page);
  // Before the engine says hello the scopes aren't known yet: nothing is greyed until they are.
  const maySetup = engine.scopes.length === 0 || engine.scopes.includes("operator.admin");
  const wanted = pageAtLevel(page, level);
  const shown = !maySetup && HIDDEN_PAGES.includes(wanted) ? "general" : wanted;
  const scrollRef = useRef<HTMLDivElement>(null);
  // The frame stays mounted across pages; a new page starts at its heading.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [shown]);
  const levelScroll = useRef<{ page: string; top: number } | null>(null);
  useLayoutEffect(() => {
    if (levelScroll.current?.page === shown && scrollRef.current) {
      scrollRef.current.scrollTop = levelScroll.current.top;
    }
    levelScroll.current = null;
  }, [level, shown]);
  const models = useResource<RecordValue>(engine, "models.list", {});
  const hasModel = list(models.data?.models).some((m) => m.available !== false);
  const changeLevel = (l: Level) => {
    const next = pageAtLevel(page, l);
    levelScroll.current = next === shown && scrollRef.current ? { page: shown, top: scrollRef.current.scrollTop } : null;
    setLevel(l);
    saveLevel(l);
    if (l === "regular") setScope(null); // "Settings for" is an Advanced control; Regular shows the default Trunk's
    if (next !== page) onPage(next);
  };
  const go = useCallback((id: string, row?: SearchRow) => {
    const want = Math.max(LV[level], row?.lv ?? 0);
    if (want > LV[level]) { const l = LEVELS[want].id; setLevel(l); saveLevel(l); }
    onPage(id);
    if (row) jump(row.title);
  }, [level, onPage, jump]);
  const runSave = useCallback((run: () => Promise<unknown>) => {
    report.saving();
    run().then(report.saved, (error: unknown) => report.failed(errorText(error)));
  }, [report]);
  const goPin = useCallback((p: Pin) => go(p[0], { page: p[0], title: p[1], lv: p[2] }), [go]);
  const pins = usePins(engine, shown, LV[level], runSave, goPin);
  const first = () => { const g = searchSettings(query, SETTINGS_ROWS)[0]?.hits[0]; if (g) go(g.page.id, g.rows[0]); };
  return (
    <div className="settings" data-testid="settings">
      <nav className="set-nav" aria-label="Settings pages" onKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || !(e.target instanceof HTMLButtonElement) || !e.target.matches(".set-item")) return;
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".set-item:not(:disabled)")];
        const index = items.indexOf(e.target);
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : step ? (index + step + items.length) % items.length : -1;
        if (index < 0 || next < 0) return;
        e.preventDefault();
        items[next]?.focus();
      }}>
        <button type="button" className="set-back" onClick={onBack}>
          <Icon name="chev" size={16} />
          <span>Back to {backName}</span>
        </button>
        <label className="set-search">
          <Icon name="search" small />
          <input placeholder="Search settings" aria-label="Search settings" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } else if (e.key === "Enter") { e.preventDefault(); first(); } }} />
        </label>
        {LV[level] >= 1 ? <ScopePicker engine={engine} scope={scope} onScope={setScope} /> : null}
        {query.trim() ? <SearchResults query={query} level={level} shown={shown} onGo={go} /> : settingsGroups(level).map((g) => ({ ...g, pages: g.pages.filter((p) => maySetup || !HIDDEN_PAGES.includes(p.id)) })).map((g) => (
          <div key={g.name} className="set-group">
            <div className="grp">{g.name}</div>
            {g.pages.map((p) => (
              <button key={p.id} type="button" className="set-item" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" data-page={p.id} aria-current={p.id === shown ? "true" : undefined} onClick={() => onPage(p.id)}>{p.name}</button>
            ))}
          </div>
        ))}
        <SaveLine state={save} />
        <LevelControl level={level} onLevel={changeLevel} />
      </nav>
      <div className="set-scroll" ref={scrollRef}>
        <div className="set-col">
          <FileProblem engine={engine} />
          <KitProvider level={LV[level]} report={report} scope={LV[level] >= 1 ? scope : null} ask={hasModel ? onAsk : undefined} askName={askName} pins={pins}>
            <SetupLock locked={!maySetup && SETUP_PAGES.includes(shown)}>
              <SettingsPage page={shown} title={pageName(shown)} level={level} engine={engine} openSettings={onPage} />
            </SetupLock>
          </KitProvider>
        </div>
      </div>
    </div>
  );
}
