// Settings › Branch › All features (R1-10 part B; preview `PAGES.featuresP17`, `featFP17`, `featGoP17`).
// Search, a status filter and one virtualised list of 4,973 features with In Branch / Partly built / Coming chips.
// Static data, no engine calls; every control here is local (data-local). "Open" shows only when the host can take
// the person to where the feature lives (onOpen) and the feature exists at least in part.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../../shell/Popover";
import { HOME, countLine, countsOf, flatten, fmt, loadAtlas, statusWord, visibleRange, TECHNICAL_AREAS, KINDS, AREA, type AtlasRow, type FeatureHome, type ListItem, type StatusFilter } from "./atlas";
import "./features.css";

export const FEATURES_TITLE = "All features";
export const FEATURES_LEDE = `Everything Branch does, will do, or learned from the apps it grew from, in one place: ${KINDS.length} kinds, ${Object.keys(AREA).length} areas.`;

export type FeaturesPageProps = {
  /** "How much to show" is Technical: the agent-loop, ops and observability areas show without a search. */
  technical: boolean;
  /** A feature id to scroll to and highlight (search results deep-link here). */
  focus?: string | null;
  /** Takes the person to where a feature lives; without it no Open buttons are drawn. */
  onOpen?: (home: FeatureHome) => void;
  /** The rows; defaults to the shipped atlas, loaded on first open. */
  rows?: readonly AtlasRow[];
};

const chipClass = (s: AtlasRow["s"]) => (s === "in Branch" ? "feat-chip in" : s === "partly built" ? "feat-chip part" : "feat-chip soon");

export function FeaturesPage({ technical, focus = null, onOpen, rows: given }: FeaturesPageProps) {
  const [loaded, setLoaded] = useState<readonly AtlasRow[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  const rows = given ?? loaded;
  useEffect(() => {
    if (given) return;
    let live = true;
    loadAtlas().then((all) => { if (live) setLoaded(all); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [given]);

  const focusRow = useMemo(() => (focus && rows ? rows.find((row) => row.id === focus) ?? null : null), [focus, rows]);
  // A deep link into a Technical area below Technical searches for the feature by name, as the preview does.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [focused, setFocused] = useState<string | null>(null);
  // A new deep link resets the list to show it (state adjusted while rendering, not in an effect).
  const focusKey = focusRow ? `${focusRow.id}|${technical}` : null;
  const [applied, setApplied] = useState<string | null>(null);
  if (focusKey !== applied) {
    setApplied(focusKey);
    if (focusRow) {
      setFilter("all");
      setFocused(focusRow.id);
      setQuery(TECHNICAL_AREAS.has(focusRow.a) && !technical ? focusRow.f : "");
    }
  }

  const flat = useMemo(() => flatten(rows ?? [], { query, filter, technical }), [rows, query, filter, technical]);
  const counts = useMemo(() => countsOf(rows ?? []), [rows]);

  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [rows]);
  // Scroll the focused feature into view (80 px under the top) once the list holds it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !focused) return;
    const i = flat.items.findIndex((item) => item.kind === "r" && item.row.id === focused);
    if (i < 0) return;
    el.scrollTop = Math.max(0, flat.offsets[i]! - 80);
    setView({ top: el.scrollTop, height: el.clientHeight });
  }, [focused, flat]);
  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { const el = box.current; if (el) setView({ top: el.scrollTop, height: el.clientHeight }); });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const [from, to] = visibleRange(flat, view.top, view.height);
  const open = (home: FeatureHome | undefined) => (home && onOpen ? () => onOpen(home) : null);

  const item = (it: ListItem, top: number) => {
    if (it.kind === "k") return <div key={it.key} className="feat-k" style={{ top }} role="presentation">{it.label}</div>;
    if (it.kind === "a") {
      const go = open(HOME[it.area]);
      return <div key={it.key} className="feat-a" style={{ top }}>
        <b>{it.label}</b><small>{fmt(it.count)}</small>
        {go ? <button type="button" className="feat-go" data-local onClick={go} aria-label={`Open ${it.label}`}>Open</button> : null}
      </div>;
    }
    const { row } = it;
    const go = row.s !== "planned" ? open(HOME[row.a]) : null;
    return <div key={it.key} className={row.id === focused ? "feat-r focus" : "feat-r"} style={{ top }} data-fid={row.id} role="listitem">
      <span className="feat-t"><b>{row.f}</b><small>{row.w}</small></span>
      <span className={chipClass(row.s)}>{statusWord(row.s)}</span>
      {go ? <button type="button" className="feat-go" data-local onClick={go} aria-label={`Open where ${row.f} lives`}>Open</button> : null}
    </div>;
  };

  const total = rows?.length ?? 0;
  return <div className="feat-page">
    <div className="feat-bar">
      <label className="feat-search">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <input data-local value={query} placeholder={`Search ${fmt(total)} features`} autoComplete="off" aria-label="Search all features"
          onChange={(e) => { setQuery(e.target.value); setFocused(null); }} />
      </label>
      <div data-local className="feat-seg">
        <Segmented label="Show" value={filter} onChange={setFilter} options={[
          { id: "all", name: `All ${fmt(counts.all)}` },
          { id: "in", name: `In Branch ${fmt(counts.in)}` },
          { id: "part", name: `Partly built ${fmt(counts.part)}` },
          { id: "soon", name: `Coming ${fmt(counts.soon)}` },
        ]} />
      </div>
    </div>
    <p className="feat-count" aria-live="polite">{failed ? "The feature list didn't load." : rows ? countLine(flat, total) : ""}</p>
    <div ref={box} className="feat-list" tabIndex={0} role="list" aria-label="All features" aria-busy={!rows && !failed} onScroll={onScroll}>
      <div className="feat-in" style={{ height: flat.height }}>
        {flat.items.slice(from, to).map((it, i) => item(it, flat.offsets[from + i]!))}
      </div>
      {rows && !flat.items.length ? <p className="feat-empty">Nothing matches. Try another word.</p> : null}
    </div>
  </div>;
}
