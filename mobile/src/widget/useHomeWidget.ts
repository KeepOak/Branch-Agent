import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { ApprovalsSnapshot } from '../approvals/approvals';
import type { ChatListSnapshot } from '../chats/chatList';
import { homeWidgetCopy, parseWidgetAction, type WidgetAction } from './homeWidget';
import { loadHomeWidget, publishHomeWidget } from './native';

/** Keep the Android home-screen widget in sync, and open Ask Branch / Approvals / Home from a tap. */
export function useHomeWidget(args: {
  paired: boolean;
  approvals: ApprovalsSnapshot;
  chats: ChatListSnapshot;
  now?: number;
  onAction: (action: WidgetAction) => void;
}): void {
  const { paired, approvals, chats, now = Date.now(), onAction } = args;
  const copy = homeWidgetCopy({
    paired,
    pending: approvals.pending,
    trunks: approvals.trunks,
    rows: chats.rows,
    now,
  });

  useEffect(() => {
    publishHomeWidget(copy);
  }, [copy.title, copy.detail, copy.counts, copy.askLabel, copy.work, copy.action]);

  useEffect(() => {
    const native = loadHomeWidget();
    if (!native) return;
    const apply = (raw: string | null | undefined) => {
      const action = parseWidgetAction(raw);
      if (action) onAction(action);
    };
    apply(native.takeLaunchAction());
    const launched = native.addListener('onLaunchAction', (event) => apply(event.action));
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') apply(native.takeLaunchAction());
    });
    return () => {
      launched.remove();
      app.remove();
    };
  }, [onAction]);
}
