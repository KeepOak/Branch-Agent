import { TOPIC_EMOJI, type Topic } from "@branch/gateway-protocol";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { TopicListItem } from "./contact-topics";
import "./topics-nav.css";

export type TopicLayout = "column" | "rail" | "side" | "tabs";
type Preference = { layout: TopicLayout; width: number; per: Record<string, TopicLayout> };
const KEY = "branch.topic-layout";
const DEFAULT_WIDTH: Record<TopicLayout, number> = { column: 300, rail: 64, side: 88, tabs: 0 };
export const TOPIC_LAYOUT_NAMES: Record<TopicLayout, string> = { column: "Column", rail: "Emoji rail", side: "Side tabs", tabs: "Tabs above the chat" };
export const TOPIC_LAYOUTS: TopicLayout[] = ["column", "rail", "side", "tabs"];
const NAMES = TOPIC_LAYOUT_NAMES;
const LAYOUTS = TOPIC_LAYOUTS;
const DEFAULT: Preference = { layout: "column", width: 300, per: {} };
const CHANGE_EVENT = "branch-topic-layout-changed";

function readPreference(): Preference {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Preference> | null;
    return value && value.layout && LAYOUTS.includes(value.layout)
      ? { layout: value.layout, width: Number(value.width) || DEFAULT_WIDTH[value.layout], per: value.per ?? {} }
      : DEFAULT;
  } catch { return DEFAULT; }
}
export const readTopicDefaultLayout = (): TopicLayout => readPreference().layout;
export function setTopicDefaultLayout(layout: TopicLayout): void {
  const preference = readPreference();
  try { localStorage.setItem(KEY, JSON.stringify({ ...preference, layout, width: DEFAULT_WIDTH[layout] })); } catch { /* current window still changes */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function clamp(layout: TopicLayout, width: number) {
  return layout === "side" ? Math.max(72, Math.min(120, width)) : layout === "column" ? Math.max(200, Math.min(640, width)) : DEFAULT_WIDTH[layout];
}
const time = (at: number) => at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

/** Per-window layout choice, with a per-contact override like Telegram's View menu. */
export function useTopicLayout(contactId: string | undefined) {
  const [preference, setPreference] = useState(readPreference);
  useEffect(() => { const refresh = () => setPreference(readPreference()); window.addEventListener(CHANGE_EVENT, refresh); return () => window.removeEventListener(CHANGE_EVENT, refresh); }, []);
  const layout = contactId && preference.per[contactId] || preference.layout;
  const save = (next: Preference) => { setPreference(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* layout lasts this window */ } window.dispatchEvent(new Event(CHANGE_EVENT)); };
  const choose = (next: TopicLayout, perContact = false) => save(perContact && contactId
    ? { ...preference, width: DEFAULT_WIDTH[next], per: { ...preference.per, [contactId]: next } }
    : { ...preference, layout: next, width: DEFAULT_WIDTH[next], per: contactId ? Object.fromEntries(Object.entries(preference.per).filter(([id]) => id !== contactId)) : preference.per });
  const resize = (width: number) => {
    const nextLayout = layout === "column" && width < 200 ? "rail" : layout === "rail" && width >= 200 ? "column" : layout;
    const nextWidth = nextLayout === "rail" ? preference.width : clamp(nextLayout, width);
    save(preference.per[contactId ?? ""] ? { ...preference, width: nextWidth, per: { ...preference.per, [contactId!]: nextLayout } } : { ...preference, layout: nextLayout, width: nextWidth });
  };
  return { layout, width: clamp(layout, preference.width), choose, resize };
}

type Props = {
  contactId: string; contactName: string; generalKey: string; items: TopicListItem[]; activeKey: string | null;
  allSelected: boolean; layout: TopicLayout; width: number; phoneList: boolean;
  onOpen: (key: string) => void; onAll: () => void; onLayout: (layout: TopicLayout, perContact?: boolean) => void;
  onResize: (width: number) => void; onPatch: (topic: Topic, patch: Record<string, unknown>) => Promise<void>;
};

export function TopicsNav(p: Props) {
  const [menu, setMenu] = useState<"layout" | "topic" | "emoji" | null>(null);
  const [chosen, setChosen] = useState<Topic | null>(null);
  const [rename, setRename] = useState<Topic | null>(null);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [closedOpen, setClosedOpen] = useState(false);
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; width: number } | null>(null);
  const compact = p.layout !== "column" && !p.phoneList;
  const active = p.items.filter(({ topic }) => topic.status !== "archived").sort((a, b) => Number(Boolean(b.topic.pinnedAt)) - Number(Boolean(a.topic.pinnedAt)) || b.updatedAt - a.updatedAt);
  const closed = p.items.filter(({ topic }) => topic.status === "archived");
  const search = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const emoji = search.length ? TOPIC_EMOJI.filter((item) => search.every((word) => item.name.includes(word))) : TOPIC_EMOJI;
  useEffect(() => { setMenu(null); setChosen(null); setError(""); }, [p.contactId]);
  const patch = async (topic: Topic, change: Record<string, unknown>) => {
    setError("");
    try { await p.onPatch(topic, change); setMenu(null); setRename(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, width: p.layout === "rail" ? 64 : p.width };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const width = drag.current.width + event.clientX - drag.current.x;
    drag.current = null;
    if (Math.abs(width - p.width) > 2) p.onResize(width);
  };
  const row = (item: TopicListItem) => {
    const { topic, preview, updatedAt } = item;
    const selected = p.activeKey === topic.key && !p.allSelected;
    const status = topic.status === "working" ? "working" : topic.status === "waiting" ? "needs you" : topic.status === "done" ? "done" : "";
    const hint = `${topic.title} · ${preview}`;
    return <div className={`topic-nav-row ${selected ? "selected" : ""} ${topic.muted ? "muted" : ""}`} key={topic.key}>
      {compact ? <button type="button" className="topic-nav-tab" aria-current={selected} aria-label={topic.title} title={hint} onClick={() => p.onOpen(topic.key)}><span aria-hidden="true">{topic.emoji ?? "💬"}</span><span className="topic-nav-tab-label">{topic.title}</span>{topic.unread ? <i className="topic-nav-unread" aria-label="Unread" /> : null}</button> : <>
        <button type="button" className="topic-nav-emoji" aria-label={`Change the emoji for ${topic.title}`} onClick={() => { setChosen(topic); setQuery(""); setMenu("emoji"); }}>{topic.emoji ?? "💬"}</button>
        <button type="button" className="topic-nav-open" aria-current={selected} onClick={() => p.onOpen(topic.key)}><span className="topic-nav-line"><b>{topic.title}</b><time>{time(updatedAt)}</time></span><span className="topic-nav-preview"><span>{p.contactName}: </span>{preview || "No messages yet."}</span></button>
        <button type="button" className="topic-nav-more" aria-label={`More for ${topic.title}`} onClick={() => { setChosen(topic); setMenu(menu === "topic" && chosen?.key === topic.key ? null : "topic"); }}>⋯</button>
      </>}
      {status ? <span className={`topic-nav-status ${topic.status}`}>{status}</span> : null}
      {!compact && topic.unread ? <i className="topic-nav-unread" aria-label="Unread" /> : null}
    </div>;
  };
  return <nav className={`topics-nav lay-${p.layout} ${p.phoneList ? "phone-list" : ""}`} style={{ width: p.layout === "tabs" || p.phoneList ? undefined : p.width }} aria-label={`Threads with ${p.contactName}`} data-testid="topics-nav">
    <div className="topics-nav-head"><button type="button" className="topic-layout-button" aria-label={`How threads show: ${NAMES[p.layout]}`} onClick={() => setMenu(menu === "layout" ? null : "layout")}>▤</button>{!compact ? <><b>{p.contactName}</b><small>{p.items.length} threads</small></> : null}</div>
    <div className="topics-nav-list" role={p.layout === "tabs" ? "tablist" : "list"}>
      <div className="topic-nav-row"><button type="button" className={compact ? "topic-nav-tab" : "topic-nav-open"} aria-label="General" aria-current={p.activeKey === p.generalKey && !p.allSelected} title="General" onClick={() => p.onOpen(p.generalKey)}><span className="topic-nav-general">💬</span><b>General</b></button></div>
      <div className="topic-nav-row"><button type="button" className={compact ? "topic-nav-tab" : "topic-nav-open"} aria-label="All" aria-current={p.allSelected} title="All threads" onClick={p.onAll}><span className="topic-nav-general">🗂️</span><b>All</b></button></div>
      {active.map(row)}
      {closed.length ? <><button type="button" className="topic-nav-closed" aria-expanded={closedOpen} onClick={() => setClosedOpen(!closedOpen)}>Closed · {closed.length}</button>{closedOpen ? closed.map(row) : null}</> : null}
    </div>
    {p.layout !== "tabs" && !p.phoneList ? <div className="topics-nav-resizer" role="separator" tabIndex={0} aria-label="Resize the threads. Arrow keys resize, double-click resets." aria-orientation="vertical" aria-valuenow={p.width} onPointerDown={beginDrag} onPointerUp={endDrag} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); p.onResize(p.width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 48 : 16)); } }} onDoubleClick={() => p.onResize(DEFAULT_WIDTH[p.layout])} /> : null}
    {menu === "layout" ? <div className="topic-nav-menu" role="menu"><b>Threads show as</b>{LAYOUTS.map((layout) => <button type="button" role="menuitemradio" aria-checked={p.layout === layout} key={layout} onClick={() => { p.onLayout(layout); setMenu(null); }}>{NAMES[layout]}</button>)}<small>For this contact</small>{LAYOUTS.map((layout) => <button type="button" role="menuitemradio" aria-checked={p.layout === layout} key={`per-${layout}`} onClick={() => { p.onLayout(layout, true); setMenu(null); }}>{NAMES[layout]}</button>)}</div> : null}
    {menu === "topic" && chosen ? <div className="topic-nav-menu" role="menu"><b>{chosen.title}</b><button type="button" role="menuitem" onClick={() => { setTitle(chosen.title); setRename(chosen); setMenu(null); }}>Rename</button><button type="button" role="menuitem" onClick={() => void patch(chosen, { pinned: !chosen.pinnedAt })}>{chosen.pinnedAt ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void patch(chosen, { topicMuted: !chosen.muted })}>{chosen.muted ? "Unmute" : "Mute"}</button><button type="button" role="menuitem" onClick={() => void patch(chosen, { archived: chosen.status !== "archived" })}>{chosen.status === "archived" ? "Reopen" : "Close"}</button></div> : null}
    {menu === "emoji" && chosen ? <div className="topic-nav-picker"><input type="search" aria-label="Search emoji" placeholder={`Search ${TOPIC_EMOJI.length} emoji`} value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /><div className="topic-nav-emoji-grid" role="listbox" aria-label="Emoji">{emoji.map((item) => <button type="button" role="option" key={item.emoji} aria-label={item.name} title={item.name} onClick={() => void patch(chosen, { icon: item.emoji })}>{item.emoji}</button>)}</div></div> : null}
    {rename ? <form className="topic-nav-dialog" onSubmit={(event) => { event.preventDefault(); if (title.trim()) void patch(rename, { label: title.trim() }); }}><label>Rename thread<input aria-label="Title" maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label><div><button type="button" onClick={() => setRename(null)}>Cancel</button><button type="submit" disabled={!title.trim()}>Rename</button></div></form> : null}
    {error ? <p role="alert" className="topic-nav-error">{error}</p> : null}
  </nav>;
}
