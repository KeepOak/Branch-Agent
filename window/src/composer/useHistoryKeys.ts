// Earlier messages with Up and Down (DESIGN-SPEC §4.3.1 Parity adds, row composer-input-history): Up with the
// caret on the first line brings back your earlier messages in this conversation (read from chat.history),
// Down comes forward, and Down past the newest brings back what you were writing. Nothing is sent.
import { useCallback, useRef, type KeyboardEvent } from "react";
import { errorText, list, rec, type WindowEngine } from "./engine";
import { caretOnEdge, INPUT_HISTORY_LIMIT, step, userTexts, type HistoryWalk } from "./drafts";

export function useHistoryKeys(engine: WindowEngine | undefined, text: string, setText: (t: string) => void) {
  const walk = useRef<HistoryWalk | null>(null);
  const sent = useRef<string[]>([]);
  const shown = useRef<string | null>(null);

  const record = useCallback((t: string) => {
    if (t) sent.current = [t, ...sent.current.filter((x) => x !== t)].slice(0, INPUT_HISTORY_LIMIT);
    walk.current = null;
  }, []);

  const begin = useCallback(async (): Promise<HistoryWalk> => {
    let items = sent.current;
    if (engine?.sessionKey) {
      try {
        const h = await engine.request("chat.history", { sessionKey: engine.sessionKey, limit: INPUT_HISTORY_LIMIT });
        const fromEngine = userTexts(list(rec(h).messages));
        items = [...sent.current, ...fromEngine.filter((t) => !sent.current.includes(t))].slice(0, INPUT_HISTORY_LIMIT);
      } catch (error) {
        console.warn("Earlier messages come from this window only: chat.history failed:", errorText(error));
      }
    }
    return { items, index: -1, saved: text };
  }, [engine, text]);

  const onArrow = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const dir = e.key === "ArrowUp" ? "up" : "down";
      const el = e.currentTarget;
      if (e.altKey || e.shiftKey || el.selectionStart !== el.selectionEnd || !caretOnEdge(text, el.selectionStart, dir)) return;
      // A walk ends once the words are changed by hand.
      if (walk.current && shown.current !== text) walk.current = null;
      if (!walk.current && dir === "down") return;
      e.preventDefault();
      const go = (w: HistoryWalk) => {
        const next = step(w, dir);
        if (!next) return;
        walk.current = next.walk;
        shown.current = next.text;
        setText(next.text);
      };
      if (walk.current) go(walk.current);
      else void begin().then(go);
    },
    [text, setText, begin],
  );

  /** Asks sent from this window, newest first (for Ctrl R before the engine has recorded them). */
  const sentList = useCallback(() => sent.current, []);
  return { onArrow, record, sentList };
}
