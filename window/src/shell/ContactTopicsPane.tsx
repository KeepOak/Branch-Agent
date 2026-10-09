import { useState } from "react";
import type { TopicListItem, TopicMode } from "./contact-topics";
import { groupContactTopics } from "./contact-topics";
import { distinctNames, readableTitle } from "./topic-name";
import "./contact-topics.css";

export function ContactTopicsPane({ items, name, onOpen }: { items: TopicListItem[]; name: string; onOpen: (key: string) => void }) {
  const [mode, setMode] = useState<TopicMode>("time");
  const [query, setQuery] = useState("");
  const groups = groupContactTopics(items, mode, query);
  const names = distinctNames(items.map(({ topic }) => ({ key: topic.key, name: readableTitle(topic.title) })));
  return <section className="contact-topics" aria-label={`Threads with ${name}`}>
    <div className="contact-topics-controls">
      <input type="search" aria-label="Search conversations in this contact" placeholder="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Group conversations by" value={mode} onChange={(e) => setMode(e.target.value as TopicMode)}>
        <option value="time">By time</option><option value="flat">Flat</option><option value="project">By project</option><option value="status">By status</option>
      </select>
    </div>
    {groups.every((group) => !group.items.length) ? <p className="hint">No conversations here yet.</p> : groups.map((group) => <div key={group.label} className="contact-topics-group">
      {group.label ? <h3>{group.label}</h3> : null}
      {group.items.map(({ topic, preview }) => <button type="button" className="contact-topics-row" key={topic.key} onClick={() => onOpen(topic.key)}>
        <span><strong>{names.get(topic.key) ?? readableTitle(topic.title)}</strong>{topic.unread ? <i className="unread-dot" aria-label="Unread" /> : null}</span>
        <small>{topic.status}{preview ? ` · ${preview}` : ""}</small>
      </button>)}
    </div>)}
  </section>;
}
