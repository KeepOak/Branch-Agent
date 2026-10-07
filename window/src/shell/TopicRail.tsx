import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Topic } from "@branch/gateway-protocol";
import { Face } from "../face/Face";
import { emojiList, emojiScores, emojisForTopics } from "./topic-emoji-logic";
import "./topic-rail.css";

type Layout = "column" | "rail" | "side" | "tabs";
const names: Record<Layout, string> = { column: "Column", rail: "Emoji rail", side: "Side tabs", tabs: "Tabs above the chat" };
const defaults: Record<Layout, number> = { column: 300, rail: 64, side: 88, tabs: 0 };
const key = "branch-topics-t5";
const emojiKey = "branch-topic-emoji-t5";
const titleKey = "branch-topic-title-t5";
const muteKey = "branch-topic-mute-t5";
function stored<T>(name: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(name) || "null") ?? fallback; } catch { return fallback; } }
const clock = (at: number) => at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
export function shortTopicTitle(name: string): string {
  const verb = /^(fix|watch|save|match|tidy|refactor|add|test|find|check|make|book|read|write|plan|send|put|sort|clean|update|review|build|run)\s+(?:the|a|an|my|every|all)?\s*/i;
  const start = String(name || "").split(" · ")[0]!.trim();
  const action = start.match(verb)?.[1] ?? "";
  let title = start.replace(verb, "").replace(/\s+(through|on|for|to|since|from|with|before|after|in|into)\s+.*$/i, "").trim();
  if (action && title.split(" ").length === 1 && /^(test|check|review)$/i.test(action)) title += ` ${action.toLowerCase()}`;
  return (title || name || "Thread").replace(/^./, (x) => x.toUpperCase());
}
export type TopicRailProps = {
  contactId: string; contactName: string; contactKey: string; generalPreview: string; generalUpdatedAt: number;
  currentKey: string | null; allSelected?: boolean; items: { topic: Topic; preview: string; updatedAt: number }[];
  onOpen: (key: string) => void; onAll: () => void;
  onLayout?: (layout: Layout) => void;
  onPatch: (topic: Topic, change: Record<string, unknown>) => Promise<void>;
};

/** The preview's TZ3 topic row, backed by contact topics and sessions.patch. */
export function TopicRail(p: TopicRailProps) {
  const [setting, setSetting] = useState(() => stored(key, { layout: "column" as Layout, width: 300 }));
  const [emoji, setEmoji] = useState<Record<string, string>>(() => stored(emojiKey, {}));
  const [renamed, setRenamed] = useState<Record<string, string>>(() => stored(titleKey, {}));
  const [muted, setMuted] = useState<Record<string, boolean>>(() => stored(muteKey, {}));
  const [menu, setMenu] = useState<string | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const [renaming, setRenaming] = useState<Topic | null>(null);
  const [picking, setPicking] = useState<Topic | null>(null);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const railRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const layout = setting.layout;
  useEffect(() => {
    const parent = railRef.current?.closest<HTMLElement>(".conversation-column");
    parent?.style.setProperty("--topic-width", `${setting.width}px`);
    return () => { parent?.style.removeProperty("--topic-width"); };
  }, [setting.width]);
  const clampWidth = (value: number) => layout === "side" ? Math.max(72, Math.min(120, value)) : Math.max(200, Math.min(640, value));
  const saveWidth = (width: number) => { const value = { ...setting, width: clampWidth(width) }; localStorage.setItem(key, JSON.stringify(value)); setSetting(value); };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.button !== 0) return; drag.current = { x: event.clientX, width: setting.width }; event.currentTarget.setPointerCapture(event.pointerId); };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => { if (drag.current) setSetting((current) => ({ ...current, width: clampWidth(drag.current!.width + event.clientX - drag.current!.x) })); };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => { if (!drag.current) return; const width = drag.current.width + event.clientX - drag.current.x; drag.current = null; if (layout === "column" && width < 200) changeLayout("rail"); else saveWidth(width); };
  const changeLayout = (next: Layout) => { const value = { layout: next, width: defaults[next] }; localStorage.setItem(key, JSON.stringify(value)); setSetting(value); setMenu(null); p.onLayout?.(next); };
  const changeEmoji = (topic: Topic) => { setPicking(topic); setEmojiQuery(""); setMenu(null); };
  const chooseEmoji = (topic: Topic, chosen: string) => { const value = { ...emoji, [topic.key]: chosen }; localStorage.setItem(emojiKey, JSON.stringify(value)); setEmoji(value); setPicking(null); };
  const toggleMute = (topic: Topic) => { const value = { ...muted, [topic.key]: !muted[topic.key] }; localStorage.setItem(muteKey, JSON.stringify(value)); setMuted(value); setMenu(null); };
  const update = async (topic: Topic, change: Record<string, unknown>): Promise<boolean> => { setBusy(true); setError(""); try { await p.onPatch(topic, change); setMenu(null); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); } };
  const active = p.items.filter(({ topic }) => topic.status !== "archived").sort((a, b) => Number(Boolean(b.topic.pinnedAt)) - Number(Boolean(a.topic.pinnedAt)) || b.updatedAt - a.updatedAt);
  const closed = p.items.filter(({ topic }) => topic.status === "archived");
  const topicIcons = emojisForTopics(p.items.map(({ topic, preview }) => ({ key: topic.key, title: renamed[topic.key] || shortTopicTitle(topic.title), body: `${topic.title} ${preview}` })), emoji);
  const button = (id: string, label: string, icon: string, status?: Topic["status"], unread?: boolean) => { const current = id.startsWith("all-") ? Boolean(p.allSelected) : !p.allSelected && p.currentKey === id; return <button key={id} type="button" className={`tpTabT5 ${current ? "curT5" : ""}`} role={layout === "tabs" ? "tab" : undefined} aria-selected={layout === "tabs" ? current : undefined} aria-current={current} aria-label={label} onClick={() => id.startsWith("all-") ? p.onAll() : p.onOpen(id)}>{layout !== "tabs" || id !== p.contactKey ? <span className="tpEmoT5" aria-hidden="true">{icon}</span> : null}<span className="tpTabLT5">{label}</span>{status === "working" || status === "waiting" || status === "done" ? <i className={`tpStT5 ${status === "waiting" ? "needs" : status}`} aria-label={status} /> : null}{unread && !current ? <b className="tpBadgeT5" aria-label="unread">1</b> : null}</button>; };
  const row = ({ topic, preview, updatedAt }: typeof p.items[number]) => {
    const label = renamed[topic.key] || shortTopicTitle(topic.title);
    return layout === "column" ? <div className={`tpRowT5 ${p.currentKey === topic.key ? "curT5" : ""} ${muted[topic.key] ? "muteT5" : ""}`} role="listitem" key={topic.key}>
      <button className="tpEmoBtnT5" type="button" aria-label={`Change the emoji for ${label}`} onClick={() => changeEmoji(topic)}>{topicIcons[topic.key]}</button>
      <button className="tpGoT5" type="button" aria-current={p.currentKey === topic.key} onClick={() => p.onOpen(topic.key)}><span className="tpL1T5"><b>{label}</b>{topic.pinnedAt ? <i className="tpPinT5" aria-label="pinned"/> : null}{muted[topic.key] ? <i className="tpMuteT5" aria-label="muted"/> : null}<time>{clock(updatedAt)}</time></span><span className="tpL2T5"><span>{preview}</span>{topic.status === "working" || topic.status === "waiting" || topic.status === "done" ? <i className={`tpStT5 ${topic.status === "waiting" ? "needs" : topic.status}`} aria-label={topic.status}/> : null}{topic.unread && p.currentKey !== topic.key && !muted[topic.key] ? <b className="tpBadgeT5" aria-label="unread">1</b> : null}</span></button>
      <button className="tpMoreT5" type="button" aria-label={`More for ${label}`} onClick={() => setMenu(menu === topic.key ? null : topic.key)}>⋯</button>
      {menu === topic.key ? <div className="tpMenuT5" role="menu"><strong>{label}</strong><button type="button" onClick={() => void update(topic, { pinned: !topic.pinnedAt })}>{topic.pinnedAt ? "Unpin" : "Pin to top"}</button><button type="button" onClick={() => toggleMute(topic)}>{muted[topic.key] ? "Unmute" : "Mute"}</button><button type="button" onClick={() => { setRenaming(topic); setTitle(label); setMenu(null); }}>Rename…</button><button type="button" onClick={() => changeEmoji(topic)}>Change the emoji…</button><hr/><button type="button" disabled={busy} onClick={() => void update(topic, { archived: topic.status !== "archived" })}>{topic.status === "archived" ? "Reopen" : "Close"}</button></div> : null}
    </div> : button(topic.key, label, topicIcons[topic.key] || "💬", topic.status, topic.unread && !muted[topic.key]);
  };
  const general = layout === "column" ? <div className={`tpRowT5 ${p.currentKey === p.contactKey ? "curT5" : ""}`} role="listitem"><span className="tpAvT5"><Face size={34} label={p.contactName}/></span><button className="tpGoT5" type="button" aria-label="General" aria-current={p.currentKey === p.contactKey} onClick={() => p.onOpen(p.contactKey)}><span className="tpL1T5"><b>General</b><time>{clock(p.generalUpdatedAt)}</time></span><span className="tpL2T5"><span>{p.generalPreview ? `${p.contactName}: ${p.generalPreview}` : ""}</span></span></button></div> : button(p.contactKey, "General", "💬");
  return <nav ref={railRef} className={`topicsT5 lay-${layout}`} aria-label="Threads" style={{ "--topw": `${setting.width}px` } as CSSProperties}>
    {layout === "column" ? <div className="tpHeadT5"><button className="tpLayT5" type="button" aria-label={`How threads show: ${names[layout]}`} onClick={() => setMenu(menu === "layout" ? null : "layout")}>▤</button><b>{p.contactName}</b><small>{p.items.length} thread{p.items.length === 1 ? "" : "s"}</small></div> : <button className="tpLayT5" type="button" aria-label={`How threads show: ${names[layout]}`} onClick={() => setMenu(menu === "layout" ? null : "layout")}>▤</button>}
    {menu === "layout" ? <div className="tpMenuT5 layout" role="menu"><strong>Threads show as</strong>{(Object.keys(names) as Layout[]).map((choice) => <button key={choice} type="button" role="menuitemradio" aria-checked={choice === layout} onClick={() => changeLayout(choice)}>{names[choice]}</button>)}</div> : null}
    <div className={layout === "column" ? "tpListT5" : "tpTabsT5"} role={layout === "tabs" ? "tablist" : "list"} aria-label={`Threads with ${p.contactName}`}>
      {layout === "tabs" || layout === "side" ? button(`all-${p.contactId}`, "All", "💬") : null}{general}{active.map(row)}
      {closed.length && layout === "column" ? <button type="button" className="tpClosedHT5" aria-expanded={closedOpen} onClick={() => setClosedOpen(!closedOpen)}>{closedOpen ? "⌄" : "›"} Closed · {closed.length}</button> : null}
      {(layout === "tabs" || layout === "side" || closedOpen) ? closed.map(row) : null}
    </div>
    {(layout === "column" || layout === "side") ? <div className="tpResT5" role="separator" aria-orientation="vertical" aria-label="Resize the threads. Arrow keys resize, double-click resets." aria-valuenow={setting.width} tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onDoubleClick={() => saveWidth(defaults[layout])} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const width = setting.width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 48 : 16); if (layout === "column" && width < 200) changeLayout("rail"); else saveWidth(width); }}/>: null}
    {renaming ? <div className="tpDialogT5" role="dialog" aria-modal="true" aria-label="Rename thread"><form onSubmit={(e) => { e.preventDefault(); const value = title.trim(); if (!value) return; void update(renaming, { label: value }).then((saved) => { if (!saved) return; const next = { ...renamed, [renaming.key]: value }; localStorage.setItem(titleKey, JSON.stringify(next)); setRenamed(next); setRenaming(null); }); }}><h2>Rename thread</h2><label>Title<input autoFocus maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)}/></label><div><button type="button" onClick={() => setRenaming(null)}>Cancel</button><button type="submit" disabled={busy || !title.trim()}>Rename</button></div></form></div> : null}
    {picking ? <div className="tpEmojiPickerT5" role="dialog" aria-label={`Change the emoji for ${shortTopicTitle(picking.title)}`}><input autoFocus value={emojiQuery} onChange={(e) => setEmojiQuery(e.target.value)} aria-label="Search emoji" placeholder={`Search ${emojiList.length} emoji`}/><div role="listbox" aria-label="Emoji">{(() => { const words = emojiQuery.toLowerCase().trim().split(/\s+/).filter(Boolean); const ranked = words.length ? [...emojiScores(emojiQuery).map(([icon]) => emojiList.find((item) => item.e === icon)).filter((item) => item !== undefined), ...emojiList.filter((item) => words.every((word) => item.n.includes(word)))] : emojiList; const seen = new Set<string>(); const matches = ranked.filter((item) => !seen.has(item.e) && !!seen.add(item.e)).slice(0, 600); return matches.length ? matches.map((item) => <button type="button" role="option" key={item.e} aria-label={item.n} title={item.n} onClick={() => chooseEmoji(picking, item.e)}>{item.e}</button>) : <p>No emoji match.</p>; })()}</div><button type="button" onClick={() => setPicking(null)}>Close</button></div> : null}
    {error ? <p className="tpErrorT5" role="alert">{error}</p> : null}
  </nav>;
}
