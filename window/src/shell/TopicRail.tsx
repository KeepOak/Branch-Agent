import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Topic } from "@branch/gateway-protocol";
import { Face } from "../face/Face";
import { Dialog } from "./Dialog";
import { Menu, type MenuAnchor, type MenuItem } from "./Menu";
import { menuIcon } from "./menu-icons";
import { notify } from "./notify";
import { emojiList, emojiScores, emojisForTopics } from "./topic-emoji-logic";
import { distinctNames, isRawSessionKey, readableTitle, sessionKeyName, splitKeyTag } from "./topic-name";
import { readTopicSettings, saveTopicSettings, setContactTopicLayout, setDefaultTopicLayout, topicLayoutDefaults as defaults, topicLayoutNames as names, TOPIC_LAYOUT_KEY as key, type TopicLayout as Layout } from "./topic-layout";
import "./topic-rail.css";

const emojiKey = "branch-topic-emoji-t5";
const muteKey = "branch-topic-mute-t5";
function stored<T>(name: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(name) || "null") ?? fallback; } catch { return fallback; } }
const displayTitle = (topic: Topic) => topic.labelled ? readableTitle(topic.title) : shortTopicTitle(topic.title);
const tabLabel = (label: string) => { const { name, tag } = splitKeyTag(label); return <><span className="tpTabNameT5">{name}</span>{tag ? <span className="tpTabTagT5"> · {tag}</span> : null}</>; };
const clock = (at: number) => at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
export function shortTopicTitle(name: string): string {
  const verb = /^(fix|watch|save|match|tidy|refactor|add|test|find|check|make|book|read|write|plan|send|put|sort|clean|update|review|build|run)\s+(?:the|a|an|my|every|all)?\s*/i;
  if (isRawSessionKey(name)) return sessionKeyName(name.trim());
  const start = String(name || "").split(" · ")[0]!.trim();
  const action = start.match(verb)?.[1] ?? "";
  let title = start.replace(verb, "").replace(/\s+(through|on|for|to|since|from|with|before|after|in|into)\s+.*$/i, "").trim();
  if (action && title.split(" ").length === 1 && /^(test|check|review)$/i.test(action)) title += ` ${action.toLowerCase()}`;
  return (title || name || "Thread").replace(/^./, (x) => x.toUpperCase());
}
export type TopicRailProps = {
  contactId: string; contactName: string; contactKey: string; generalPreview: string; generalWho?: string; generalUpdatedAt: number;
  currentKey: string | null; allSelected?: boolean; items: { topic: Topic; preview: string; who?: string; updatedAt: number }[];
  phoneList?: boolean;
  onOpen: (key: string) => void; onAll: () => void;
  onLayout?: (layout: Layout) => void;
  onPatch: (topic: Topic, change: Record<string, unknown>) => Promise<void>;
};

/** The preview's TZ3 topic row, backed by contact topics and sessions.patch. */
export function TopicRail(p: TopicRailProps) {
  const [setting, setSetting] = useState(readTopicSettings);
  const [emoji, setEmoji] = useState<Record<string, string>>(() => stored(emojiKey, {}));
  const [muted, setMuted] = useState<Record<string, boolean>>(() => stored(muteKey, {}));
  const [menu, setMenu] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<MenuAnchor>({ x: 0, y: 0 });
  const [closedOpen, setClosedOpen] = useState(false);
  const [renaming, setRenaming] = useState<Topic | null>(null);
  const [picking, setPicking] = useState<Topic | null>(null);
  const [pickerAt, setPickerAt] = useState<MenuAnchor>({ x: 0, y: 0 });
  const [emojiQuery, setEmojiQuery] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const railRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const railDrag = useRef<number | null>(null);
  const [draggingRail, setDraggingRail] = useState(false);
  const chosenLayout = setting.per[p.contactId] ?? setting.layout;
  const layout = typeof innerWidth !== "undefined" && innerWidth <= 640 && chosenLayout === "side" ? "tabs" : chosenLayout;
  const displayedLayout = draggingRail ? "rail" : layout;
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setSetting(readTopicSettings());
      if (event.key === emojiKey) setEmoji(stored(emojiKey, {}));
      if (event.key === muteKey) setMuted(stored(muteKey, {}));
    };
    window.addEventListener("storage", sync);
    const localSync = () => setSetting(readTopicSettings());
    window.addEventListener("branch:topic-layout-changed", localSync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("branch:topic-layout-changed", localSync); };
  }, []);
  useEffect(() => {
    const parent = railRef.current?.closest<HTMLElement>(".conversation-column");
    parent?.style.setProperty("--topic-width", `${setting.width}px`);
    return () => { parent?.style.removeProperty("--topic-width"); };
  }, [setting.width]);
  const clampWidth = (value: number) => layout === "side" ? Math.max(72, Math.min(120, value)) : Math.max(200, Math.min(640, value));
  const saveWidth = (width: number) => { const value = { ...readTopicSettings(), width: clampWidth(width) }; saveTopicSettings(value); setSetting(value); };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.button !== 0) return; drag.current = { x: event.clientX, width: setting.width }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add("drag"); };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => { if (drag.current) { const width = drag.current.width + event.clientX - drag.current.x; setDraggingRail(layout === "column" && width < 200); setSetting((current) => ({ ...current, width: width < 200 && layout === "column" ? 64 : clampWidth(width) })); } };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => { if (!drag.current) return; const width = drag.current.width + event.clientX - drag.current.x; drag.current = null; setDraggingRail(false); event.currentTarget.classList.remove("drag"); if (layout === "column" && width < 200) changeLayout("rail", defaults.column, Boolean(setting.per[p.contactId])); else saveWidth(width); };
  const changeLayout = (next: Layout, width = defaults[next], perContact = false) => { if (perContact) setContactTopicLayout(p.contactId, next); else setDefaultTopicLayout(next, p.contactId); const value = { ...readTopicSettings(), width: next === "rail" ? defaults.column : width }; saveTopicSettings(value); setSetting(value); setMenu(null); p.onLayout?.(next); };
  const changeEmoji = (topic: Topic, anchor?: HTMLElement) => { const button = anchor ?? [...(railRef.current?.querySelectorAll<HTMLElement>(".tpEmoBtnT5") ?? [])].find((node) => node.dataset.topicKey === topic.key); const rect = button?.getBoundingClientRect(); setPickerAt({ x: rect?.left ?? 8, y: (rect?.bottom ?? 60) + 4 }); setPicking(topic); setEmojiQuery(""); setMenu(null); };
  const chooseEmoji = (topic: Topic, chosen: string) => { const value = { ...stored<Record<string, string>>(emojiKey, {}), [topic.key]: chosen }; localStorage.setItem(emojiKey, JSON.stringify(value)); setEmoji(value); setPicking(null); notify(`${chosen} ${displayTitle(topic)}`); };
  const toggleMute = (topic: Topic) => { const current = stored<Record<string, boolean>>(muteKey, {}); const value = { ...current, [topic.key]: !current[topic.key] }; localStorage.setItem(muteKey, JSON.stringify(value)); setMuted(value); setMenu(null); notify(value[topic.key] ? "Muted. It won’t mark itself unread." : "Unmuted."); };
  const update = async (topic: Topic, change: Record<string, unknown>): Promise<boolean> => { setBusy(true); setError(""); try { await p.onPatch(topic, change); setMenu(null); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); } };
  const openMenu = (name: string, anchor: HTMLElement) => { const rect = anchor.getBoundingClientRect(); setMenuAt({ x: rect.left, y: rect.bottom + 4 }); setMenu(menu === name ? null : name); };
  const menuTopic = p.items.find(({ topic }) => topic.key === menu)?.topic;
  const menuItems: MenuItem[] = menu === "layout" ? [
    { kind: "head", label: "Threads show as" },
    ...(Object.entries(names) as [Layout, string][]).map(([choice, label]) => ({ label, checked: choice === layout, radio: true, run: () => changeLayout(choice) })),
  ] : menuTopic ? [
    { kind: "head", label: displayTitle(menuTopic) },
    { label: menuTopic.pinnedAt ? "Unpin" : "Pin to top", icon: menuIcon("pin"), run: () => { void update(menuTopic, { pinned: !menuTopic.pinnedAt }).then((saved) => { if (saved) notify(menuTopic.pinnedAt ? "Unpinned." : "Pinned to the top."); }); } },
    { label: muted[menuTopic.key] ? "Unmute" : "Mute", icon: menuIcon("bell"), run: () => toggleMute(menuTopic) },
    { label: "Rename…", icon: menuIcon("edit"), run: () => { setRenaming(menuTopic); setTitle(displayTitle(menuTopic)); } },
    { label: "Change the emoji…", icon: menuIcon("star"), run: () => changeEmoji(menuTopic) },
    { kind: "sep" },
    { label: menuTopic.status === "archived" ? "Reopen" : "Close", icon: menuIcon("check"), run: () => { void update(menuTopic, { archived: menuTopic.status !== "archived" }).then((saved) => { if (saved) notify(menuTopic.status === "archived" ? "Reopened." : "Closed. It’s under Closed at the bottom."); }); } },
  ] : [];
  // General is rendered separately from the additional topics.
  const threadCount = p.items.length + 1;
  const active = p.items.filter(({ topic }) => topic.status !== "archived").sort((a, b) => Number(Boolean(b.topic.pinnedAt)) - Number(Boolean(a.topic.pinnedAt)) || b.updatedAt - a.updatedAt);
  const closed = p.items.filter(({ topic }) => topic.status === "archived");
  const topicIcons = emojisForTopics(p.items.map(({ topic, preview }) => ({ key: topic.key, title: displayTitle(topic), body: `${topic.title} ${preview}` })), emoji);
  const button = (id: string, label: string, icon: string, status?: Topic["status"], unread?: boolean) => { const all = id.startsWith("all-"); const current = all ? Boolean(p.allSelected) : !p.allSelected && p.currentKey === id; const statusWord = status === "waiting" ? "needs you" : status === "working" || status === "done" ? status : ""; return <button key={id} type="button" className={`tpTabT5 ${current ? "curT5" : ""}`} role={displayedLayout === "tabs" ? "tab" : undefined} aria-selected={displayedLayout === "tabs" ? current : undefined} aria-current={current} aria-label={`${label}${statusWord ? `, ${statusWord}` : ""}`} data-tip={all ? "Every thread’s messages, newest last" : label} onClick={() => all ? p.onAll() : p.onOpen(id)}>{id === p.contactKey && displayedLayout !== "tabs" ? <span className="tpAvT5"><Face size={26} label={p.contactName}/></span> : (all && displayedLayout === "tabs") || (id === p.contactKey && displayedLayout === "tabs") ? null : <span className="tpEmoT5" aria-hidden="true">{icon}</span>}<span className="tpTabLT5">{tabLabel(label)}</span>{statusWord ? <i className={`tpStT5 ${status === "waiting" ? "needs" : status}`} role="img" aria-label={statusWord} /> : null}{unread && !current ? <b className="tpBadgeT5" aria-label="unread">1</b> : null}</button>; };
  const rowNames = distinctNames(p.items.map(({ topic }) => ({ key: topic.key, name: displayTitle(topic) })));
  const row = ({ topic, preview, who, updatedAt }: typeof p.items[number]) => {
    const label = rowNames.get(topic.key) ?? displayTitle(topic);
    return displayedLayout === "column" ? <div className={`tpRowT5 ${p.currentKey === topic.key ? "curT5" : ""} ${muted[topic.key] ? "muteT5" : ""}`} role="listitem" key={topic.key}>
      <button className="tpEmoBtnT5" type="button" data-topic-key={topic.key} aria-label={`Change the emoji for ${label}`} data-tip="Change the emoji" onClick={(event) => changeEmoji(topic, event.currentTarget)}>{topicIcons[topic.key]}</button>
      <button className="tpGoT5" type="button" aria-current={p.currentKey === topic.key} data-tip={`${label} · ${who ? `${who}: ` : ""}${preview}`} onClick={() => p.onOpen(topic.key)}><span className="tpL1T5"><b>{label}</b>{topic.pinnedAt ? <i className="tpPinT5" aria-label="pinned"/> : null}{muted[topic.key] ? <i className="tpMuteT5" aria-label="muted"/> : null}<time>{clock(updatedAt)}</time></span><span className="tpL2T5">{who && preview ? <i className="tpWhoT5">{who}:</i> : null}<span>{preview}</span>{topic.status === "working" || topic.status === "waiting" || topic.status === "done" ? <i className={`tpStT5 ${topic.status === "waiting" ? "needs" : topic.status}`} role="img" aria-label={topic.status === "waiting" ? "needs you" : topic.status}/> : null}{topic.unread && p.currentKey !== topic.key && !muted[topic.key] ? <b className="tpBadgeT5" aria-label="unread">1</b> : null}</span></button>
      <button className="tpMoreT5" type="button" aria-label={`More for ${label}`} aria-haspopup="menu" onClick={(event) => openMenu(topic.key, event.currentTarget)}>⋯</button>
    </div> : button(topic.key, label, topicIcons[topic.key] || "💬", topic.status, topic.unread && !muted[topic.key]);
  };
  const general = displayedLayout === "column" ? <div className={`tpRowT5 ${p.currentKey === p.contactKey ? "curT5" : ""}`} role="listitem"><span className="tpAvT5"><Face size={34} label={p.contactName}/></span><button className="tpGoT5" type="button" aria-label="General" aria-current={p.currentKey === p.contactKey} data-tip={`General · ${p.generalWho ? `${p.generalWho}: ` : ""}${p.generalPreview}`} onClick={() => p.onOpen(p.contactKey)}><span className="tpL1T5"><b>General</b><time>{clock(p.generalUpdatedAt)}</time></span><span className="tpL2T5">{p.generalWho && p.generalPreview ? <i className="tpWhoT5">{p.generalWho}:</i> : null}<span>{p.generalPreview}</span></span></button></div> : button(p.contactKey, "General", "💬");
  return <nav ref={railRef} className={`topicsT5 lay-${displayedLayout}${p.phoneList && innerWidth <= 640 ? " listT5" : ""}`} aria-label="Threads" style={{ "--topw": `${displayedLayout === "rail" ? 64 : setting.width}px` } as CSSProperties} onPointerDown={(event) => { if (layout !== "rail" || event.button !== 0 || (event.target as Element).closest(".pop")) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX >= rect.right - 6) { railDrag.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerUp={(event) => { if (railDrag.current === null) return; const width = 64 + event.clientX - railDrag.current; railDrag.current = null; if (width >= 200) changeLayout("column", Math.min(640, width), Boolean(setting.per[p.contactId])); }}>
    {displayedLayout === "column" ? <div className="tpHeadT5"><button className="tpLayT5 icon-btn" type="button" aria-haspopup="menu" aria-label={`How threads show: ${names[layout]}`} data-tip="How threads show" onClick={(event) => openMenu("layout", event.currentTarget)}>{menuIcon("panel")}</button><b>{p.contactName}</b><small>{threadCount} thread{threadCount === 1 ? "" : "s"}</small></div> : <button className="tpLayT5 icon-btn" type="button" aria-haspopup="menu" aria-label={`How threads show: ${names[layout]}`} data-tip="How threads show" onClick={(event) => openMenu("layout", event.currentTarget)}>{menuIcon("panel")}</button>}
    {menu ? <Menu at={menuAt} items={menuItems} label={menu === "layout" ? "Threads show as" : "Thread options"} onClose={() => setMenu(null)} /> : null}
    <div className={displayedLayout === "column" ? "tpListT5" : "tpTabsT5"} role={displayedLayout === "tabs" ? "tablist" : "list"} aria-label={`Threads with ${p.contactName}`}>
      {displayedLayout === "tabs" || displayedLayout === "side" ? button(`all-${p.contactId}`, "All", "💬") : null}{general}{active.map(row)}
      {closed.length && displayedLayout === "column" ? <button type="button" className="tpClosedHT5" aria-expanded={closedOpen} onClick={() => setClosedOpen(!closedOpen)}>{closedOpen ? "⌄" : "›"} Closed · {closed.length}</button> : null}
      {(displayedLayout === "tabs" || displayedLayout === "side" || (displayedLayout === "column" && closedOpen)) ? closed.map(row) : null}
    </div>
    {(layout === "column" || layout === "side") ? <div className="tpResT5" role="separator" aria-orientation="vertical" aria-label="Resize the threads. Arrow keys resize, double-click resets." aria-valuenow={setting.width} tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onDoubleClick={() => saveWidth(defaults[layout])} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const width = setting.width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 48 : 16); if (layout === "column" && width < 200) changeLayout("rail", defaults.column, Boolean(setting.per[p.contactId])); else saveWidth(width); }}/>: null}
    {renaming ? <Dialog title="Rename thread" onClose={() => setRenaming(null)} footer={<><button className="btn ghost" type="button" onClick={() => setRenaming(null)}>Cancel</button><button className="btn pri" type="submit" form="topic-rename-form" disabled={busy || !title.trim()}>Rename</button></>}><form id="topic-rename-form" onSubmit={(e) => { e.preventDefault(); const value = title.trim(); if (!value) return; void update(renaming, { label: value }).then((saved) => { if (saved) setRenaming(null); }); }}><label className="fld"><span>Title</span><input className="inp" autoFocus onFocus={(event) => event.currentTarget.select()} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)}/></label></form></Dialog> : null}
    {picking ? <Menu at={pickerAt} label={`Change the emoji for ${displayTitle(picking)}`} onClose={() => setPicking(null)} items={[{ kind: "custom", node: <div className="emoPickT5"><input className="inp" autoFocus value={emojiQuery} onChange={(e) => setEmojiQuery(e.target.value)} aria-label="Search emoji" placeholder={`Search ${emojiList.length} emoji`}/><div className="emoGridT5" role="listbox" aria-label="Emoji">{(() => { const words = emojiQuery.toLowerCase().trim().split(/\s+/).filter(Boolean); const ranked = words.length ? [...emojiScores(emojiQuery).map(([icon]) => emojiList.find((item) => item.e === icon)).filter((item) => item !== undefined), ...emojiList.filter((item) => words.every((word) => item.n.includes(word)))] : emojiList; const seen = new Set<string>(); const matches = ranked.filter((item) => !seen.has(item.e) && !!seen.add(item.e)).slice(0, 600); return matches.length ? matches.map((item) => <button type="button" role="option" key={item.e} aria-label={item.n} title={item.n} onClick={() => chooseEmoji(picking, item.e)}>{item.e}</button>) : <p>No emoji match.</p>; })()}</div></div> }]}/> : null}
    {error ? <p className="tpErrorT5" role="alert">{error}</p> : null}
  </nav>;
}
