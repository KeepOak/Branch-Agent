// Library (DESIGN-SPEC §4.6.4; preview 40-places, 42-placesbp, 93-g3p, 94-g4p, 96-appopsp): the head with Canvas,
// "Translate a document…" and "Make pictures…", then Memory, Documents, Meetings and Activity (what Trunks made, and your day).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { PlaceScroll, type PlaceProps } from "../../places-nav/PlaceFrame";
import { optStr, rec, trunksOf, useResource } from "./data";
import { DocumentsTab } from "./documents";
import { MeetingsTab } from "./meetings";
import { ActivityTab, type ActivityPart } from "./activity";
import { useMemoryFiles } from "./memory-data";
import { MemoryTab } from "./memory";
import { Grey } from "./parts";
import { Status } from "./ui";
import "./library.css";

export const HEAD_REASONS = {
  canvas: "Needs an engine method that lists Clearings: canvas.document.view opens one only by its id.",
  translate: "Needs the engine’s document translation method.",
  pictures: "Needs the engine’s picture-making method.",
};

const TABS = [["memory", "Memory"], ["documents", "Documents"], ["meetings", "Meetings"], ["activity", "Activity"]] as const;
type Tab = (typeof TABS)[number][0];
/** The old tab names, still asked for by links elsewhere, open the matching part of Activity. */
const ACTIVITY_NAMES: Record<string, ActivityPart> = { made: "made", "made for you": "made", "made by trunks": "made", logbook: "day", "your day": "day" };

/** A tab named by id or by its visible name ("Activity"), or null. Old names ("Made for you", "Logbook") mean Activity. */
export function libraryTab(name: unknown): Tab | null {
  const want = String(name ?? "").toLowerCase();
  if (Object.hasOwn(ACTIVITY_NAMES, want)) return "activity";
  return TABS.find(([id, label]) => id === want || label.toLowerCase() === want)?.[0] ?? null;
}

function LibraryTabs({ value, onChange, counts }: { value: Tab; onChange: (t: Tab) => void; counts: Partial<Record<Tab, number>> }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = TABS.length;
    const next = event.key === "ArrowRight" ? (index + 1) % n : event.key === "ArrowLeft" ? (index - 1 + n) % n : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onChange(TABS[next][0]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div className="kp-tabs lib-tabs" role="tablist" aria-label="Library">{TABS.map(([id, name], index) =>
    <button key={id} type="button" role="tab" aria-selected={id === value} tabIndex={id === value ? 0 : -1} onKeyDown={e => move(e, index)} onClick={() => onChange(id)}>
      {name}{counts[id] ? <span className="lib-n">{counts[id]}</span> : null}
    </button>)}</div>;
}

export function LibraryPlace({ engine, level, openSettings, openConversation }: PlaceProps) {
  const trunks = useResource<unknown>(engine, "agents.list");
  const [tab, setTab] = useState<Tab>("memory");
  const [part, setPart] = useState<ActivityPart>("made");
  useEffect(() => {
    // Other places open Library on a tab: openPlace("library"), then this event.
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<{ place?: string; tab?: string }>).detail;
      const next = detail?.place === "library" ? libraryTab(detail.tab) : null;
      if (next) setTab(next);
      const want = String(detail?.tab ?? "").toLowerCase();
      if (next === "activity" && Object.hasOwn(ACTIVITY_NAMES, want)) setPart(ACTIVITY_NAMES[want]);
    };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
  const list = useMemo(() => (trunks.data === null ? null : trunksOf(trunks.data)), [trunks.data]);
  const memory = useMemoryFiles(engine, list);
  const defaultId = engine.agentId || optStr(rec(trunks.data).defaultId) || list?.[0]?.id || "";
  const facts = memory.files?.reduce((n, f) => n + f.facts.length, 0);
  return <PlaceScroll><div className="place lib">
    <h1>Library</h1>
    <Grey label="Clearing" reason={HEAD_REASONS.canvas} className="lib-canvas" />
    <p className="lede">What your Trunks remember, the documents they read, your meetings, and everything they made.</p>
    <div className="lib-head-acts"><Grey label="Translate a document…" reason={HEAD_REASONS.translate} /><Grey label="Make pictures…" reason={HEAD_REASONS.pictures} /></div>
    <div className="lib-body">
      <LibraryTabs value={tab} onChange={setTab} counts={{ memory: facts }} />
      <Status {...trunks} />
      {list && (tab === "memory" ? <MemoryTab engine={engine} level={level} trunks={list} files={memory.files} reloadFiles={memory.reload} defaultId={defaultId} openSettings={openSettings} />
        : tab === "documents" ? <DocumentsTab engine={engine} level={level} trunks={list} defaultId={rec(trunks.data).selectionRequired === true ? undefined : optStr(rec(trunks.data).defaultId)} mainKey={optStr(rec(trunks.data).mainKey)} />
        : tab === "meetings" ? <MeetingsTab engine={engine} level={level} trunks={list} openSettings={openSettings} />
        : <ActivityTab engine={engine} trunks={list} part={part} onPart={setPart} openConversation={openConversation} openSettings={openSettings} />)}
    </div>
  </div></PlaceScroll>;
}
