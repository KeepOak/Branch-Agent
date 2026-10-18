// Where a notification tap should land. Posted as expo-notifications `data`, then read back
// from a button press, a tap, or the launch response that opened the app.
import type { ChatRow } from '../chats/chatList';

export type AlertRoute =
  | { screen: 'approvals'; approvalId?: string }
  | { screen: 'chat'; sessionKey: string }
  | { screen: 'inbox' }
  | { screen: 'settings' };

export type AlertData = {
  approvalId?: string;
  screen?: string;
  sessionKey?: string;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function alertData(route: AlertRoute, approvalId?: string): AlertData {
  if (route.screen === 'chat') return { screen: 'chat', sessionKey: route.sessionKey };
  if (route.screen === 'settings') return { screen: 'settings' };
  if (route.screen === 'inbox') return { screen: 'inbox' };
  return { screen: 'approvals', ...(approvalId || route.approvalId ? { approvalId: approvalId ?? route.approvalId } : {}) };
}

export function parseAlertRoute(data: unknown): AlertRoute | null {
  const d = rec(data);
  const screen = str(d.screen);
  const sessionKey = str(d.sessionKey);
  const approvalId = str(d.approvalId);
  if (screen === 'chat' && sessionKey) return { screen: 'chat', sessionKey };
  if (screen === 'settings') return { screen: 'settings' };
  if (screen === 'inbox') return { screen: 'inbox' };
  if (screen === 'approvals' || approvalId) return { screen: 'approvals', ...(approvalId ? { approvalId } : {}) };
  return null;
}

/** The Chats row a chat notification should open, or a stub the chat screen can still load. */
export function chatRowForAlert(sessionKey: string, rows: readonly ChatRow[]): ChatRow {
  return (
    rows.find((row) => row.key === sessionKey) ?? {
      key: sessionKey,
      title: 'Chat',
      avatar: '?',
      preview: '',
      updatedAt: 0,
      working: false,
      unread: false,
      pinned: false,
      needsYou: false,
      room: false,
      archived: false,
      snoozedUntil: null,
      automation: false,
    }
  );
}
