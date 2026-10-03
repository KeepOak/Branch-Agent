// Ctrl R in the message box (the preview's "Search what you've asked", SESSIONS-0088): what you've asked before,
// this conversation first (chat.history), then every conversation's transcript search (sessions.search) once you
// type. The highlighted ask is previewed in the box; Enter keeps it, Escape puts your draft back.
import { useEffect, useRef, useState, type RefObject } from "react";
import { errorText, list, rec, str, type WindowEngine } from "./engine";
import { INPUT_HISTORY_LIMIT, userTexts } from "./drafts";
import { Icon } from "./icons";
import { Popover } from "./Popover";

const SHOWN = 8;

/** Past asks, newest first, without commands or repeats. */
export function pastAsks(own: readonly string[], found: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...own, ...found]) {
    const text = t.trim();
    if (!text || text.startsWith("/") || seen.has(text) || (q && !text.toLowerCase().includes(q))) continue;
    seen.add(text);
    out.push(text);
  }
  return out.slice(0, SHOWN);
}

/** A transcript match's words without the search's " … " cut marks. */
export function snippetText(snippet: string): string {
  return snippet.replace(/^\s*…\s*/, "").replace(/\s*…\s*$/, "").trim();
}

type Props = {
  anchor: RefObject<HTMLElement | null>;
  engine?: WindowEngine;
  /** Asks sent from this window that the engine may not have recorded yet. */
  sent: readonly string[];
  draft: string;
  onPreview: (text: string) => void;
  onDone: (text: string) => void;
};

export function HistorySearch({ anchor, engine, sent, draft, onPreview, onDone }: Props) {
  const [query, setQuery] = useState("");
  const [own, setOwn] = useState<string[]>([...sent]);
  const [found, setFound] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [at, setAt] = useState(0);
  const original = useRef(draft);

  useEffect(() => {
    if (!engine?.sessionKey) return;
    let live = true;
    engine.request("chat.history", { sessionKey: engine.sessionKey, limit: INPUT_HISTORY_LIMIT }).then(
      (h) => live && setOwn((cur) => [...cur, ...userTexts(list(rec(h).messages))]),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [engine]);

  useEffect(() => {
    const q = query.trim();
    if (!engine || !q) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      engine.request("sessions.search", { scope: {}, query: q, limit: 25 }).then(
        (r) => live && setFound(list(rec(r).results).filter((x) => x.role === "user").map((x) => snippetText(str(x.snippet)))),
        (e: unknown) => live && setError(errorText(e)),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [engine, query]);

  const rows = pastAsks(own, found, query);
  const pick = Math.min(at, Math.max(0, rows.length - 1));
  const shown = rows[pick];
  useEffect(() => {
    if (shown !== undefined) onPreview(shown);
  }, [shown, onPreview]);

  const done = (keep: boolean) => onDone(keep ? (rows[pick] ?? original.current) : original.current);
  return (
    <Popover anchor={anchor} onClose={() => done(false)} label="Search what you've asked" className="c-hist">
      <div className="c-pt">Search what you’ve asked</div>
      <label className="c-search">
        <Icon name="search" size={15} />
        <input
          autoFocus
          placeholder="Type to search"
          aria-label="Search what you've asked"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            const n = rows.length || 1;
            if (e.key === "Enter") {
              e.preventDefault();
              done(true);
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
              e.preventDefault();
              setAt((pick + (e.key === "ArrowUp" ? n - 1 : 1)) % n);
            }
          }}
        />
      </label>
      <div role="listbox" aria-label="What you've asked">
        {rows.length ? (
          rows.map((t, i) => (
            <button key={t} type="button" role="option" aria-selected={i === pick} className="c-mi" onMouseEnter={() => setAt(i)} onClick={() => onDone(t)}>
              <span className="c-mi-t">
                <span className="c-hist-t">{t.slice(0, 120)}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="c-pp">{error || "Nothing you’ve asked matches."}</p>
        )}
      </div>
      <p className="c-pp">Enter uses it · Esc puts your draft back</p>
    </Popover>
  );
}
