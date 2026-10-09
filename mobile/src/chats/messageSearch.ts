// Message search for Chats: every chat's transcript through sessions.search, after a 200 ms pause in typing,
// the way the window's palette and sidebar search do (window/src/shell/Palette.tsx, search-model.ts).
import { useEffect, useState } from 'react';

export type MessageHit = { key: string; role: 'user' | 'assistant'; snippet: string; at: number; messageId: string };

/** The scope the window's palette sends: people's chats, not helpers, automations or system. */
export const SEARCH_SCOPE = { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, excludeSubagents: true, excludeCron: true, excludeSystem: true } as const;

export const SEARCH_DELAY_MS = 200;

/** One message search on the computer, with the params the window's palette sends. */
export function messageSearcher(request: (method: string, params?: unknown) => Promise<unknown>): (query: string) => Promise<unknown> {
  return (query) => request('sessions.search', { query, limit: 25, scope: SEARCH_SCOPE });
}

/** Reads sessions.search `results[]`, at most 25 (the most one message search returns). */
export function readMessageHits(result: unknown): MessageHit[] {
  const items = (result as { results?: unknown } | null)?.results;
  if (!Array.isArray(items)) return [];
  return items.slice(0, 25).map((raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      key: String(r.sessionKey ?? ''),
      role: r.role === 'user' ? 'user' : 'assistant',
      snippet: String(r.snippet ?? '').replace(/\s+/g, ' ').trim(),
      at: typeof r.timestamp === 'number' ? r.timestamp : 0,
      messageId: String(r.messageId ?? ''),
    };
  });
}

export type MessageSearch = { hits: MessageHit[]; searching: boolean; note: string };

/** The hits for what's typed; a failed search says so and leaves the name matches showing. */
export function useMessageSearch(search: ((query: string) => Promise<unknown>) | undefined, query: string): MessageSearch {
  const [state, setState] = useState<MessageSearch>({ hits: [], searching: false, note: '' });
  const q = query.trim();
  useEffect(() => {
    if (!q || !search) {
      setState({ hits: [], searching: false, note: '' });
      return;
    }
    let current = true;
    setState((s) => ({ ...s, searching: true }));
    const timer = setTimeout(() => {
      search(q).then(
        (r) => {
          if (!current) return;
          const indexing = (r as { indexing?: boolean } | null)?.indexing === true;
          setState({ hits: readMessageHits(r), searching: false, note: indexing ? 'Still looking through older messages. Search again shortly.' : '' });
        },
        () => {
          if (current) setState({ hits: [], searching: false, note: 'Message search isn’t available right now. Showing chat names only.' });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [search, q]);
  return state;
}
