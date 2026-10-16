import type { ChatRow } from './chatList';

/** Trunk status chips on the r50 Chats list: Working, Waiting for you, Done. */
export type ChatStatusKind = 'working' | 'waiting' | 'idle';

export function rowStatus(row: ChatRow): ChatStatusKind {
  if (row.working) return 'working';
  if (row.needsYou) return 'waiting';
  return 'idle';
}

export type StatusChip = {
  kind: ChatStatusKind;
  /** Working, Waiting for you, or Done. */
  label: string;
  /** The status dot is the only colour on the chip. */
  dot: 'ok' | 'warn' | 'ink3';
};

/** Rooms keep the unread count and skip the status chip, as the preview's p50sRow does. */
export function statusChip(row: ChatRow): StatusChip | null {
  if (row.room) return null;
  const kind = rowStatus(row);
  if (kind === 'working') return { kind, label: 'Working', dot: 'ok' };
  if (kind === 'waiting') return { kind, label: 'Waiting for you', dot: 'warn' };
  return { kind, label: 'Done', dot: 'ink3' };
}

/** Unread badge: the engine only marks unread, so a marked row is at least one. */
export function unreadBadge(row: ChatRow): number {
  return row.unread ? 1 : 0;
}
