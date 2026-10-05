import type { Topic } from "@branch/gateway-protocol";
import type { Block } from "./model";

export type TopicUpdate = { topic: Topic; text: string; at: number; unread: boolean };

/** Find the last thread item at or before a topic event; -1 means before the first item. */
export function topicPosition(history: readonly Block[], at: number, afterMessageId?: string): number {
  if (afterMessageId) {
    const exact = history.findIndex((block) => block.key === afterMessageId || ((block.kind === "user" || block.kind === "text") && block.meta?.entryId === afterMessageId));
    if (exact >= 0) return exact;
  }
  let position = -1;
  let observedTime = false;
  history.forEach((block, index) => {
    const stamp = block.kind === "user" || block.kind === "text" ? block.meta?.timestamp : undefined;
    const time = stamp ?? NaN;
    if (Number.isFinite(time)) observedTime = true;
    if (Number.isFinite(time) && time <= at) position = index;
  });
  return position < 0 && !observedTime && history.length ? history.length - 1 : position;
}

export function TopicOrigin({ topic, onOpen }: { topic: Topic; onOpen: (key: string) => void }) {
  return <button type="button" className="topic-origin" onClick={() => onOpen(topic.key)}>Started a conversation: {topic.title}</button>;
}

export function TopicCard({ update, onOpen }: { update: TopicUpdate; onOpen: (key: string) => void }) {
  return <button type="button" className="topic-update" data-testid={`topic-card-${update.topic.key}`} onClick={() => onOpen(update.topic.key)}>
    <strong>{update.topic.title}</strong><span>{update.topic.status}</span>
    {update.unread ? <span className="topic-new">New</span> : null}
    <small>{update.text}</small>
  </button>;
}
