// Where a notification tap should land. Posted as expo-notifications `data`, then read back
// from a button press, a tap, or the launch response that opened the app.
import type { ChatRow } from '../chats/chatList';

export type AlertRoute =
  | { screen: 'approvals'; approvalId?: string }
  | { screen: 'chat'; sessionKey: string }
  | { screen: 'settings' };

export type AlertData = {
  approvalId?: string;
  screen?: string;
  sessionKey?: string;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Gateway session keys the phone can open as a chat. Anything else is ignored on tap. */
export function isAgentSessionKey(key: string): boolean {
  return key.startsWith('agent:');
}

export function alertData(route: AlertRoute, approvalId?: string): AlertData {
  if (route.screen === 'chat') return { screen: 'chat', sessionKey: route.sessionKey };
  if (route.screen === 'settings') return { screen: 'settings' };
  return { screen: 'approvals', ...(approvalId || route.approvalId ? { approvalId: approvalId ?? route.approvalId } : {}) };
}

export function parseAlertRoute(data: unknown): AlertRoute | null {
  const d = rec(data);
  const screen = str(d.screen);
  const sessionKey = str(d.sessionKey);
  const approvalId = str(d.approvalId);
  if (screen === 'chat') {
    if (!isAgentSessionKey(sessionKey)) return null;
    return { screen: 'chat', sessionKey };
  }
  if (screen === 'settings') return { screen: 'settings' };
  // Inbox on the phone is the Approvals screen. Older payloads used screen: inbox.
  if (screen === 'approvals' || screen === 'inbox' || approvalId) {
    return { screen: 'approvals', ...(approvalId ? { approvalId } : {}) };
  }
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
