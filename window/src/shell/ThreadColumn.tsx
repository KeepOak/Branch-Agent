import { useState, type MouseEvent } from "react";
import { Face } from "../face/Face";
import type { TopicListItem } from "./contact-topics";
import "./v23-layout.css";

type Props = {
  name: string;
  generalKey: string;
  openKey: string | null;
  items: TopicListItem[];
  onOpen: (key: string) => void;
  /** Right-click (or Shift+F10) on a thread: opens its menu at the pointer or the row. */
  onMenu?: (e: MouseEvent<HTMLElement>, key: string, label: string) => void;
};

/** Main's v23 thread column stays until the preview topic row is mounted for that contact. */
export function shouldShowThreadColumn(p: {
  chat: boolean;
  focus: boolean;
  stage: boolean;
  draft: boolean;
  generalKey: string | null | undefined;
  topicRow: boolean;
}): boolean {
  return p.chat && !p.focus && !p.stage && !p.draft && Boolean(p.generalKey) && !p.topicRow;
}

/** The preview's per-contact threads, separate from the Control tower. */
export function ThreadColumn({ name, generalKey, openKey, items, onOpen, onMenu }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState(false);
  const threads = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  return <nav className={visible ? "v23-threads" : "v23-threads v23-threads-hidden"} aria-label={`Threads with ${name}`}>
    <div className="v23-threads-head">
      <button type="button" className="v23-layout-button" aria-label={`How threads show: ${visible ? "Column" : "Hidden"}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>◫</button>
      <strong>{name}</strong><small>{threads.length + 1} {threads.length ? "conversations" : "conversation"}</small>
      {menu ? <div className="v23-threads-menu" role="menu" aria-label="Threads show as">
        <button type="button" role="menuitemradio" aria-checked={visible} onClick={() => { setVisible(true); setMenu(false); }}>Column</button>
        <button type="button" role="menuitemradio" aria-checked={!visible} onClick={() => { setVisible(false); setMenu(false); }}>Hidden</button>
      </div> : null}
    </div>
    {visible ? <>
      <button type="button" className={`v23-thread-row${openKey === generalKey ? " current" : ""}`} aria-current={openKey === generalKey} onClick={() => onOpen(generalKey)}>
        <Face size={32} label={name} /><span className="v23-thread-copy"><b>General</b><small>Conversation with {name}</small></span>
      </button>
      {threads.length ? <>
        <button type="button" className="v23-threads-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "⌄" : "›"} Threads · {threads.length}</button>
        {expanded ? threads.map(({ topic, preview, updatedAt }) => <button type="button" key={topic.key} className={`v23-thread-row${openKey === topic.key ? " current" : ""}`} aria-current={openKey === topic.key} onClick={() => onOpen(topic.key)}
          onContextMenu={(e) => { e.preventDefault(); onMenu?.(e, topic.key, topic.title); }}
          onKeyDown={(e) => { if (e.key === "F10" && e.shiftKey) { e.preventDefault(); onMenu?.(e as unknown as MouseEvent<HTMLElement>, topic.key, topic.title); } }}>
          <span className="v23-thread-icon" aria-hidden="true">💬</span><span className="v23-thread-copy"><b>{topic.title}</b><small>{preview || "No messages yet"}</small></span><time>{updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</time>
          {topic.unread ? <i className="v23-thread-unread" aria-label="Unread" /> : null}
        </button>) : null}
      </> : null}
    </> : null}
  </nav>;
}
