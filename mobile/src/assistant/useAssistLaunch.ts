import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { chatForNew, type ChatRow } from '../chats/chatList';
import { loadAssistant } from './native';

/** Where the assist gesture lands: a new chat, the same pick as New chat, or Chats when there is none yet. */
export function routeForAssist(rows: ChatRow[], now = Date.now()): { name: 'chat'; row: ChatRow } | { name: 'chats' } {
  const row = chatForNew(rows, now);
  return row ? { name: 'chat', row } : { name: 'chats' };
}

/**
 * Open a new chat when Android's assist gesture picks Branch Agent (Settings › Default apps › Digital assistant app).
 * Unpaired, the app simply opens where it is, so pairing stays the first step.
 */
export function useAssistLaunch(args: { paired: boolean; rows: ChatRow[]; onOpen: (route: ReturnType<typeof routeForAssist>) => void }): void {
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    const native = loadAssistant();
    if (!native) return;
    const apply = () => {
      if (!native.takeAssist()) return;
      const { paired, rows, onOpen } = latest.current;
      if (paired) onOpen(routeForAssist(rows));
    };
    apply();
    const sub = native.addListener('onAssist', apply);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') apply();
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, []);
}
