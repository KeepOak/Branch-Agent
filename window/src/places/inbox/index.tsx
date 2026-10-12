// Inbox (DESIGN-SPEC §4.6.2; preview renderInbox + 40-places + 41-placesap p20-inbox / p25-history): Needs you,
// Finished, History and Later.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { NoticesBell } from "./Bell";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import type { WindowEngine } from "../../connect/engine";
import { has, loadNeeds, loadNeedsCount, markRead, refreshesInbox, usePlaceData } from "./data";
import { takeInboxHandoff, type InboxTab } from "./handoff";
import { History, loadHistory, type HistoryData } from "./History";
import { NeedsYou, needsCount } from "./NeedsYou";
import { Finished, Later, finishedRows } from "./Tabs";
import "../overview/overview.css";
import "./inbox.css";

const TABS: { id: InboxTab; name: string }[] = [{ id: "needs", name: "Needs you" }, { id: "finished", name: "Finished" }, { id: "history", name: "History" }, { id: "later", name: "Later" }];

function TabRow({ tab, set, counts, markAll, bell }: { tab: InboxTab; set: (t: InboxTab) => void; counts: Partial<Record<InboxTab, number>>; markAll?: () => void; bell: ReactNode }) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); set(TABS[next].id);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div className="ib-tabs">
    <div role="tablist" aria-label="Inbox" className="ib-tablist">{TABS.map((t, i) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onKeyDown={e => move(e, i)} onClick={() => set(t.id)}>{t.name}{counts[t.id] ? <span className="ib-n">{counts[t.id]}</span> : null}</button>)}</div>
    {bell}
    {markAll ? <button type="button" className="ib-mar" onClick={markAll}>Mark all read</button> : null}
  </div>;
}

/** What the Needs you chip counts, for the sidebar badge and window title: 0 while loading, offline or after an error.
 *  `ready` is the connection; it loads again each time the window connects. */
export function useNeedsCount(engine: WindowEngine, ready = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!ready) { setCount(0); return; }
    let live = true, generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const id = ++generation;
      loadNeedsCount(engine).then(n => { if (live && id === generation) setCount(n); }, e => { console.warn("Inbox count", e); if (live && id === generation) setCount(0); });
    };
    load();
    const dispose = engine.onEvent(({ event }) => { if (refreshesInbox(event)) { clearTimeout(timer); timer = setTimeout(load, 150); } });
    return () => { live = false; clearTimeout(timer); dispose(); };
  }, [engine, ready]);
  return count;
}

/** The tab another place asks for with the window event "branch:place-tab" ({ place: "inbox", tab }). */
export function tabFromName(name: unknown): InboxTab | null {
  const n = typeof name === "string" ? name.trim().toLowerCase() : "";
  return TABS.find(t => t.id === n || t.name.toLowerCase() === n)?.id ?? null;
}

export function InboxPlace({ engine, level, openConversation, openPlace, openSettings }: PlaceProps) {
  const [handoff] = useState(takeInboxHandoff);
  const [tab, setTab] = useState<InboxTab>(handoff?.tab ?? "needs");
  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<{ place?: string; tab?: string }>).detail;
      const next = detail?.place === "inbox" ? tabFromName(detail.tab) : null;
      if (next) setTab(next);
    };
    window.addEventListener("branch:place-tab", onTab);
    return () => window.removeEventListener("branch:place-tab", onTab);
  }, []);
  const needs = usePlaceData(engine, loadNeeds);
  const history = usePlaceData<HistoryData>(engine, tab === "history" ? loadHistory : null);
  const data = needs.data;
  const unread = (data?.sessions ?? []).filter(s => s.unread && (tab === "needs" || finishedRows([s]).length));
  const canMark = (tab === "needs" || tab === "finished") && unread.length > 0 && has(engine, "operator.sessions.write");
  const markAll = () => void needs.act(() => markRead(engine, unread), "All marked read.");
  return <PlaceFrame title="Inbox" lede="Everything a Trunk is waiting on you for, what finished, and a record of what ran.">
    <TabRow tab={tab} set={setTab} counts={{ needs: needsCount(data) }} markAll={canMark ? markAll : undefined} bell={<NoticesBell data={data} openConversation={openConversation} openSettings={openSettings} />} />
    {needs.loading && !data ? <p role="status" className="ib-hint">Reading the Inbox…</p> : null}
    {needs.error ? <p role="alert" className="ib-err">{needs.error}</p> : null}
    {tab === "needs" ? data?.errors.map(error => <p className="ib-err" role="alert" key={error}>{error}</p>) : null}
    {needs.notice ? <p role="status" className="ib-notice">{needs.notice}</p> : null}
    {tab === "needs" && data ? <NeedsYou engine={engine} data={data} busy={needs.busy} act={needs.act} level={level} loading={needs.loading} openConversation={openConversation} openPlace={openPlace} openSettings={openSettings} /> : null}
    {tab === "finished" && data ? <Finished list={data.sessions} agents={data.agents.list} loading={needs.loading} open={openConversation} /> : null}
    {tab === "history" ? <>
      {history.loading && !history.data ? <p role="status" className="ib-hint">Reading what ran…</p> : null}
      {history.error ? <p role="alert" className="ib-err">{history.error}</p> : null}
      {history.data?.errors.map(error => <p className="ib-err" role="alert" key={error}>{error}</p>)}
      {history.data ? <History engine={engine} data={history.data} level={level} people={handoff?.people} open={openConversation} /> : null}
    </> : null}
    {tab === "later" ? <Later /> : null}
  </PlaceFrame>;
}
