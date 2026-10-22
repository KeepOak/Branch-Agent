// Home-screen widget copy: the preview's Android widget (design/spec-v23 phHowtoG18)
// plus Ask Branch. A tap opens a new chat, Approvals, or Home from data the phone already has.
import { headline } from '../approvals/approvalWords';
import { trunkOf, type Approval, type Trunk } from '../approvals/approvals';
import { chatForNew, unreadCount, type ChatRow } from '../chats/chatList';
import { workingNow } from '../home/homeModel';

export const WIDGET_ACTIONS = ['ask', 'open', 'approvals'] as const;
export type WidgetAction = (typeof WIDGET_ACTIONS)[number];

export const ASK_BRANCH = 'Ask Branch';

export type HomeWidgetCopy = {
  title: string;
  detail: string;
  counts: string;
  askLabel: string;
  work: string;
  /** Body tap: Approvals while something waits, otherwise Home. */
  action: WidgetAction;
};

export function parseWidgetAction(value: string | null | undefined): WidgetAction | null {
  return WIDGET_ACTIONS.includes(value as WidgetAction) ? (value as WidgetAction) : null;
}

export { chatForNew };

export function routeForWidgetAction(
  action: WidgetAction,
  rows: ChatRow[],
  now = Date.now(),
): { name: 'chat'; row: ChatRow } | { name: 'approvals' } | { name: 'home' } | { name: 'chats' } {
  if (action === 'approvals') return { name: 'approvals' };
  if (action === 'ask') {
    const row = chatForNew(rows, now);
    return row ? { name: 'chat', row } : { name: 'chats' };
  }
  return { name: 'home' };
}

function countPart(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return n === 1 ? one : `${n} ${many}`;
}

/** Widget words from pending approvals and the chat list, or a pair prompt when this phone is unpaired. */
export function homeWidgetCopy(input: {
  paired: boolean;
  pending: readonly Approval[];
  trunks: Record<string, Trunk>;
  rows: ChatRow[];
  now: number;
}): HomeWidgetCopy {
  const askLabel = ASK_BRANCH;
  if (!input.paired) {
    return {
      title: ASK_BRANCH,
      detail: 'Pair this phone with Branch on your computer.',
      counts: '',
      askLabel,
      work: '',
      action: 'open',
    };
  }
  const waiting = input.pending.length;
  const unread = unreadCount(input.rows, input.now);
  const working = workingNow(input.rows);
  const work = working[0] ? `${working[0].title} working` : '';
  const counts = [countPart(waiting, '1 waiting', 'waiting'), countPart(unread, '1 unread', 'unread')].filter(Boolean).join(' · ');
  const first = input.pending[0];
  if (first) {
    return {
      title: `${trunkOf(first, input.trunks).name} needs you`,
      detail: headline(first),
      counts,
      askLabel,
      work,
      action: 'approvals',
    };
  }
  return {
    title: 'Nothing is waiting for you.',
    detail: 'Everything is on track.',
    counts: counts || 'Ask Branch to start a chat',
    askLabel,
    work,
    action: 'open',
  };
}
