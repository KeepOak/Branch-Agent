// R1 Settings frame, ported from the approved preview (item 36): the nav column with search and "How much to show" at
// the top and the pages in their groups, a page title with Learn more that scrolls away with the page (v15), and one glass card per section. Rows come
// from the row table (rows.ts) and draw through RowView; a section with no rows in the table yet is Coming (R1-10). A
// page can instead draw its own component (slots.ts, such as Chat apps); nav, search and the level stay the frame's. A
// row page can also draw some rows with its own control (slots.ts controls, such as Appearance's theme gallery).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { configStore } from "../../places/settings/config-store";
import { TrunkHost } from "../../places-nav/TrunkHost";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { pinsOf } from "../../places/settings/pins";
import { GOTO_SUB, LEVELS, NAV, PAGES, TOP_PAGES, pageFor, pageShown, sectionNeed, type Level, type NavPage, type PageId } from "./nav";
import { COMING_FROM, ROWS, cardRows, comingRow, pageFirstLevel, rowHelp, rowLabel, rowLevel, type Row, type UiHints } from "./rows";
import { LaterRows } from "./LaterRows";
import { RowView, Segmented } from "./RowView";
import { mergeRows, type PageSlots, type SlotControl } from "./slots";
import { NOTHING_MATCHES, SEARCH_PLACEHOLDER, firstHit, searchSettings, type SearchHit, type SearchInput } from "./search";
import { INVALID_CONFIG, useSchemaHints } from "./useRow";
import "../../glass/glass.css";
import "./settings.css";

const LEVEL_WORD = ["regular", "advanced", "technical"] as const;
const LEVEL_KEY = "branch.level";
export const SECTION_COMING = (card: string) => `${card} comes to this page in a later update.`;
export const ASK_COMING = "Asking a Trunk from Settings comes in a later update.";
export const MAKE_DEFAULT_COMING = "Making a Trunk the default from Settings comes in a later update.";
const FINE = "Fine-tune each part";
const NO_SLOTS: PageSlots = {};

/** The level kept in this window's storage, or null when there is none or storage is blocked (it must never throw
 *  while Settings draws). */
function savedLevel(): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(LEVEL_KEY); } catch { return null; }
}

/** What config.get says is wrong with an invalid settings file, one line each. */
function configIssues(issues: unknown): string[] {
  return (Array.isArray(issues) ? issues : []).map((issue) => {
    if (typeof issue === "string") return issue;
    const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown };
    const where = typeof path === "string" && path ? path : Array.isArray(path) ? path.join(".") : "";
    const what = typeof message === "string" ? message : JSON.stringify(issue);
    return where ? `${where}: ${what}` : what;
  });
}

/** The person's level: their look's "level" (users.prefs ui.window.look, or this device without a profile). */
export function useLevel(engine: WindowEngine): [Level, (level: Level) => void] {
  const store = lookStore(engine);
  const snap = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap, () => store.snap);
  useEffect(() => { if (store.snap.where === "loading") void store.load(); }, [store]);
  const word = snap.look.level ?? savedLevel();
  const level = Math.max(0, LEVEL_WORD.indexOf(word as (typeof LEVEL_WORD)[number])) as Level;
  const set = (next: Level) => {
    try { localStorage.setItem(LEVEL_KEY, LEVEL_WORD[next]); } catch { /* storage off: the look store still keeps it */ }
    void store.set("level", LEVEL_WORD[next]).catch(() => undefined);
  };
  return [level, set];
}

export type SettingsFrameProps = {
  engine: WindowEngine;
  /** The page to open: a new id, or an old id that is sent to its new page. */
  page?: string;
  onPage?: (page: PageId) => void;
  /** What search also finds; each is optional and only searched when given. */
  places?: SearchInput["places"];
  trunks?: SearchInput["trunks"];
  features?: SearchInput["features"];
  onOpenPlace?: (id: string) => void;
  onTrunk?: (id: string, action: "open" | "makeDefault" | "new") => void;
  onOpenFeature?: (id: string) => void;
  /** Starts a conversation with a Trunk about this page; without it, Ask a Trunk is Coming. */
  onAsk?: (text: string) => void;
  rows?: Row[];
  /** Pages that draw their own component and may add rows to the table, merged by id (a clash throws). */
  pages?: PageSlots;
};

function NavButton({ page, current, onOpen, sub }: { page: NavPage; current: boolean; onOpen: () => void; sub?: string }) {
  return (
    <button type="button" className="r1s-nav" data-local="" aria-current={current ? "page" : undefined} data-page={page.id} onClick={onOpen}>
      <span>{page.title}</span>{sub ? <small>{sub}</small> : null}
    </button>
  );
}

function Results({ engine, hits, onOpen, onMakeDefault }: { engine: WindowEngine; hits: ReturnType<typeof searchSettings>; onOpen: (hit: SearchHit) => void; onMakeDefault?: (id: string) => void }) {
  const groups: [string, SearchHit[]][] = [["Settings", hits.settings], ["Go to", hits.goto], ["Trunks", hits.trunks], ["Features", hits.features]];
  if (!groups.some(([, list]) => list.length)) return <p className="r1s-none g-label" role="status">{NOTHING_MATCHES}</p>;
  return (
    <>
      {groups.filter(([, list]) => list.length).map(([title, list]) => (
        <div key={title} role="group" aria-label={title}>
          <div className="r1s-grp g-label">{title}</div>
          {list.map((hit) => {
            const button = (
              <button key={`${hit.kind}:${hit.id}`} type="button" className="r1s-nav r1s-res" data-local="" data-hit={hit.id} onClick={() => onOpen(hit)}>
                <span><b data-lv={hit.kind === "row" && hit.level > 0 ? LEVELS[hit.level].label : undefined}>{hit.label}</b>{"sub" in hit && hit.sub ? <small>{hit.sub}</small> : null}</span>
              </button>
            );
            if (hit.kind !== "trunk" || !hit.actions.includes("makeDefault")) return button;
            // Make default is its own button beside the Trunk, so it never reads as part of opening it.
            return (
              <div key={`${hit.kind}:${hit.id}`} className="r1s-hit">
                {button}
                {/* Make default is a config.patch of the default agent (HANDOFF R1-06); without a host that makes it, Coming here (#1049). */}
                <Coming engine={engine} need="config.patch" unwired={!onMakeDefault} reason={onMakeDefault ? undefined : MAKE_DEFAULT_COMING} where="Settings search › Make default">
                  <button type="button" className="r1s-link r1s-mkdef" onClick={() => onMakeDefault?.(hit.id)}>Make default</button>
                </Coming>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** A card's rows: its regular rows, then the finer ones (Advanced and Technical) in a borderless "Fine-tune each part"
 *  group, as in the preview's .s36Fine. A card with no regular row shown draws its rows flat. */
type RowHost = { engine: WindowEngine; hints: UiHints; controls?: Record<string, SlotControl>; onPage?: (page: PageId) => void };

/** A row its page draws itself (slots.ts controls): the row's label, help and level tag, then the page's control in
 *  the control's place. A list-sized control (a "custom" row) takes the row's full width under its label. */
function SlotRow({ engine, row, hints, control: Control, onPage }: RowHost & { row: Row; control: SlotControl }) {
  const level = rowLevel(row, hints);
  const tag = level > 0 ? LEVELS[level].label : undefined;
  const help = rowHelp(row, hints);
  if (row.bare) return (
    <div id={`row-${row.id}`} className="r1s-row r1s-stack" data-row={row.id} data-lv={tag} data-slot="" data-bare="" aria-label={rowLabel(row, hints)}>
      <div className="r1s-ctl r1s-own"><Control engine={engine} row={row} onPage={onPage} /></div>
    </div>
  );
  return (
    <div id={`row-${row.id}`} className={`r1s-row${row.control === "custom" ? " r1s-stack" : ""}`} data-row={row.id} data-lv={tag} data-slot="">
      <b className="g-label" data-lv={tag}>{rowLabel(row, hints)}</b>
      {help ? <small className="g-label" data-lines>{help}</small> : null}
      <div className="r1s-ctl r1s-own"><Control engine={engine} row={row} onPage={onPage} /></div>
    </div>
  );
}

function OneRow({ row, ...host }: RowHost & { row: Row }) {
  const control = host.controls?.[row.id];
  return control ? <SlotRow {...host} row={row} control={control} /> : <RowView engine={host.engine} row={row} />;
}

function CardRows({ rows, ...host }: RowHost & { rows: Row[] }) {
  const { hints } = host;
  const regular = rows.filter((row) => rowLevel(row, hints) === 0);
  const finer = rows.filter((row) => rowLevel(row, hints) > 0);
  if (!regular.length || !finer.length) return <>{rows.map((row) => <OneRow key={row.id} {...host} row={row} />)}</>;
  return (
    <>
      {regular.map((row) => <OneRow key={row.id} {...host} row={row} />)}
      <div className="r1s-fine g-clear" role="group" aria-label={FINE}>
        <h3 className="g-label">{FINE}</h3>
        {finer.map((row) => <OneRow key={row.id} {...host} row={row} />)}
      </div>
    </>
  );
}

export function SettingsFrame(props: SettingsFrameProps) {
  const { engine } = props;
  const slots = props.pages ?? NO_SLOTS;
  const rows = useMemo(() => mergeRows(props.rows ?? ROWS, slots), [props.rows, slots]);
  const [level, setLevel] = useLevel(engine);
  const { hints } = useSchemaHints(engine);
  const [page, setPage] = useState<PageId>(() => pageFor(props.page));
  const [q, setQ] = useState("");
  const [help, setHelp] = useState(false);
  const [jump, setJump] = useState<string | null>(null);
  const [slotSecs, setSlotSecs] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const store = configStore(engine);
  const config = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap ?? store.error ?? null, () => store.snap ?? store.error ?? null);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  useEffect(() => { if (props.page !== undefined) setPage(pageFor(props.page)); }, [props.page]);

  const shownPage: PageId = pageShown(page, level) ? page : "general";
  const go = (id: PageId, row?: string) => {
    setPage(id); setHelp(false); setJump(row ?? null);
    props.onPage?.(id);
    scroller.current?.scrollTo?.({ top: 0 });
  };
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(jump);
    el?.scrollIntoView?.({ block: "center" });
    el?.setAttribute("data-flash", "");
    const t = setTimeout(() => el?.removeAttribute("data-flash"), 1400);
    setJump(null);
    return () => clearTimeout(t);
  }, [jump, shownPage, level]);

  const hits = useMemo(() => searchSettings(q, { level, hints, rows, places: props.places, trunks: props.trunks, features: props.features }), [q, level, hints, rows, props.places, props.trunks, props.features]);
  const open = (hit: SearchHit) => {
    setQ("");
    if (hit.kind === "page") go(hit.id);
    else if (hit.kind === "row") { if (hit.level > level) setLevel(hit.level); go(hit.page, `row-${hit.id}`); }
    else if (hit.kind === "place") props.onOpenPlace?.(hit.id);
    else if (hit.kind === "trunk") props.onTrunk?.(hit.id, "open");
    else if (hit.kind === "newTrunk") props.onTrunk?.("", "new");
    else props.onOpenFeature?.(hit.id);
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQ(""); }
    if (e.key === "Enter") { const hit = firstHit(hits); if (hit) open(hit); }
  };

  const spec = PAGES[shownPage];
  // General's Pinned card shows only once the person has pinned a row, as in the preview.
  const pinCount = pinsOf(lookStore(engine).snap.look).length;
  const cards = spec.cards.filter((card) => !(shownPage === "general" && card === "Pinned" && !pinCount));

  const controls = slots[shownPage]?.controls;
  const sections = cards.flatMap((card) => {
    const all = rows.filter((r) => r.page === shownPage && r.card === card);
    const visible = cardRows(shownPage, card, level, hints, rows, controls);
    if (all.length && !visible.length) return [];
    // A section with no rows yet is all Coming: Regular shows only what works today.
    if (!all.length && level < COMING_FROM) return [];
    return [{ card, visible }];
  });
  const first = pageFirstLevel(shownPage, hints, rows, controls);
  const loadFailed = typeof config === "string";
  const invalid = config && typeof config === "object" && config.valid === false ? configIssues(config.issues) : null;
  const levelLine = LEVELS[level].line;
  const Custom = slots[shownPage]?.component;

  return (
    <div className="r1set g-clear" data-level={LEVEL_WORD[level]}>
      <aside className="r1s-side g-clear" aria-label="Settings">
        <label className="r1s-search g-frost">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <input type="search" data-local="" value={q} placeholder={SEARCH_PLACEHOLDER} aria-label={SEARCH_PLACEHOLDER} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} />
        </label>
        <div className="r1s-level" data-local="">
          <Segmented label="How much to show" value={level} options={LEVELS.map((l) => ({ v: l.v, label: l.label }))} onChange={(v) => setLevel(v as Level)} />
          <small className="g-label" data-lines>{levelLine}</small>
        </div>
        <nav className="r1s-list" aria-label="Settings pages">
          {q.trim() ? <Results engine={engine} hits={hits} onOpen={open} onMakeDefault={props.onTrunk ? (id) => { setQ(""); props.onTrunk?.(id, "makeDefault"); } : undefined} /> : (
            <>
              {TOP_PAGES.map((p) => <NavButton key={p.id} page={p} current={shownPage === p.id} sub={p.id === "goto" ? GOTO_SUB : undefined} onOpen={() => go(p.id)} />)}
              {NAV.map((g) => {
                const pages = g.pages.filter((p) => pageShown(p.id, level));
                return pages.length ? (
                  <div key={g.title} role="group" aria-label={g.title} style={{ display: "contents" }}>
                    <div className="r1s-grp g-label">{g.title}</div>
                    {pages.map((p) => <NavButton key={p.id} page={p} current={shownPage === p.id} onOpen={() => go(p.id)} />)}
                  </div>
                ) : null;
              })}
            </>
          )}
        </nav>
      </aside>
      <div className="r1s-page" ref={scroller}>
        {/* Every page, row page or slot page, has the frame's title, lede and Learn more (preview s36Head, HANDOFF R1-06);
            slot pages draw no title of their own (#1049). */}
        <header className="r1s-head">
          <h1 className="g-label">{spec.title}</h1>
          <p className="r1s-lede g-label" data-lines>{spec.lede} <button type="button" className="r1s-learn" data-local="" aria-expanded={help} onClick={() => {
            // A slot page's "On this page" is its section headings, read when the sheet opens (preview s36Help reads .s36Sec).
            if (Custom) setSlotSecs([...(scroller.current?.querySelectorAll<HTMLElement>(".r1s-custom h2") ?? [])].map((h) => h.textContent?.trim() ?? "").filter(Boolean));
            setHelp((v) => !v);
          }}>Learn more</button></p>
          {help ? (
            <div className="r1s-help g-clear" role="dialog" aria-label={`About ${spec.title}`}>
              {/* A page with no sections (Go to) has no "On this page" list, as in the preview's s36Help. */}
              {(Custom ? slotSecs.length : sections.length) ? <h3 className="g-label">On this page</h3> : null}
              <ul>{Custom ? slotSecs.map((t, i) => <li key={`${i}-${t}`}><button type="button" className="r1s-link" data-local="" onClick={() => {
                setHelp(false);
                [...(scroller.current?.querySelectorAll<HTMLElement>(".r1s-custom h2") ?? [])].find((h) => h.textContent?.trim() === t)?.scrollIntoView?.({ block: "start" });
              }}>{t}</button></li>) : sections.map((s) => <li key={s.card}><button type="button" className="r1s-link" data-local="" onClick={() => { setHelp(false); setJump(`sec-${shownPage}-${s.card}`); }}>{s.card || spec.title}</button></li>)}</ul>
              {/* Ask a Trunk sends the question to the default Trunk's conversation with chat.send (the window's session.send). */}
              <Coming engine={engine} need="chat.send" unwired={!props.onAsk} reason={props.onAsk ? undefined : ASK_COMING}>
                <button type="button" className="r1s-btn" onClick={() => props.onAsk?.(`Help me with Settings › ${spec.title}.`)}>Ask a Trunk</button>
              </Coming>
            </div>
          ) : null}
        </header>
        {Custom ? <div key={shownPage} className="r1s-custom" data-slot={shownPage}><Custom engine={engine} onPage={(id) => go(id)} /></div> : <>
        <div className="r1s-col">
          {loadFailed ? <div className="r1s-notice g-frost" role="alert">Settings didn’t load · <Coming engine={engine} need="config.get"><button type="button" className="r1s-link" onClick={() => void store.load()}>Try again</button></Coming></div> : null}
          {invalid ? (
            <div className="r1s-notice r1s-invalid g-frost" role="alert">
              {INVALID_CONFIG}
              {invalid.length ? <ul>{invalid.map((line, i) => <li key={i}>{line}</li>)}</ul> : null}
            </div>
          ) : null}
          {sections.length ? sections.map(({ card, visible }) => {
            // The section's later-update rows fold into one line; its live rows draw as they always did.
            const later = visible.filter((row) => comingRow(row, controls));
            const live = visible.filter((row) => !comingRow(row, controls));
            return (
            // A section with no rows yet collapses to one quiet line, not an empty card: nothing hollow to look at.
            visible.length ? (
            <section key={card} id={`sec-${shownPage}-${card}`} className="r1s-sec g-clear" aria-label={card || spec.title}>
              {card ? <h2 className="g-label">{card}</h2> : null}
              {live.length ? <CardRows engine={engine} rows={live} hints={hints} controls={slots[shownPage]?.controls} onPage={(id) => go(id)} /> : null}
              {later.length ? <LaterRows count={later.length}><CardRows engine={engine} rows={later} hints={hints} controls={slots[shownPage]?.controls} onPage={(id) => go(id)} /></LaterRows> : null}
            </section>
            ) : (
              // Nothing to show yet: Coming through <Coming>, naming the call it waits for (nav sectionNeed).
              <Coming key={card} engine={engine} need={sectionNeed(shownPage, card)} unwired reason={SECTION_COMING(card || spec.title)} where={`${spec.title} › ${card || spec.title}`}>
                <p id={`sec-${shownPage}-${card}`} className="r1s-quiet g-label" aria-label={card || spec.title} data-lines><b>{card || spec.title}</b> · Coming. {SECTION_COMING(card || spec.title)}</p>
              </Coming>
            )
            );
          }) : (
            <div className="r1s-empty g-clear">
              <p className="g-label">These settings show at {first !== null && first > level ? LEVELS[first].label : "Advanced"}.</p>
              <button type="button" className="r1s-btn" data-local="" onClick={() => setLevel(first !== null && first > level ? first : 1)}>Show {first !== null && first > level ? LEVELS[first].label : "Advanced"}</button>
            </div>
          )}
        </div>
        </>}
      </div>
      <TrunkHost engine={engine} level={LEVEL_WORD[level]} openSettings={(page) => go(pageFor(page))} openPlace={(place) => props.onOpenPlace?.(place)} />
    </div>
  );
}
