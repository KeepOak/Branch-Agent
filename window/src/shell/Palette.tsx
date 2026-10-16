import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { filterPalette, GROUPS, messageMetaLine, moveSelection, paletteBoldParts, paletteEmptyLine, type PaletteRow } from "./palette-model";
import { readMessageHits, type MessageHit } from "./search-model";

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

type Props = {
  rows: PaletteRow[];
  request: Request;
  rowName: (key: string) => string;
  onOpenMessage: (key: string, query: string) => void;
  onClose: () => void;
};

/** Message rows from sessions.search after a 200 ms pause in typing (§4.1.7 Parity adds, palette-session-search). */
function useMessageRows(request: Request, query: string, rowName: (k: string) => string, open: (key: string, query: string) => void) {
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [searchedAt, setSearchedAt] = useState(0);
  const [note, setNote] = useState("");
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearchedAt(0);
      setNote("");
      setSearching(false);
      return;
    }
    let current = true;
    setHits([]);
    setSearching(true);
    setNote("Searching…");
    const timer = setTimeout(() => {
      const scope = { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, excludeSubagents: true, excludeCron: true, excludeSystem: true };
      request("sessions.search", { query: q, limit: 25, scope }).then(
        (r) => {
          if (current) {
            setHits(readMessageHits(r));
            setSearchedAt(Date.now());
            setNote((r as { indexing?: boolean }).indexing ? "Looking through older messages. Search again shortly." : "");
            setSearching(false);
          }
        },
        () => {
          if (current) {
            setNote("Message search isn't available right now. Showing names only.");
            setSearching(false);
          }
        },
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [request, query]);
  const rows = messagePaletteRows(hits, query, rowName, open, searchedAt);
  return { rows, note, searching };
}

/** Palette message rows carry the searched words into the destination conversation's Find bar. */
export function messagePaletteRows(hits: MessageHit[], query: string, rowName: (key: string) => string, open: (key: string, query: string) => void, now: number): PaletteRow[] {
  return hits.map((hit, i) => ({
    id: `msg:${i}`,
    group: "Messages",
    label: hit.snippet,
    hint: "",
    mark: query,
    meta: messageMetaLine(rowName(hit.key), hit.at, now),
    run: () => open(hit.key, query),
  }));
}

function BoldQuery({ text, query }: { text: string; query: string }) {
  return (
    <>
      {paletteBoldParts(text, query).map((part, index) => (part.hit ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>))}
    </>
  );
}

/** Message rows take their GROUPS slot, just before Trunks. Rows already listed keep their order; message rows only insert. */
export function paletteShown(base: PaletteRow[], messageRows: PaletteRow[]): PaletteRow[] {
  if (messageRows.length === 0) return base;
  const messagesRank = GROUPS.indexOf("Messages");
  const at = base.findIndex((r) => GROUPS.indexOf(r.group) > messagesRank);
  return at < 0 ? [...base, ...messageRows] : [...base.slice(0, at), ...messageRows, ...base.slice(at)];
}

/** Find anything (DESIGN-SPEC §4.1.7): the field, the grouped list, Up/Down/Enter/Escape, and the footer. */
export function Palette({ rows, request, rowName, onOpenMessage, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const messages = useMessageRows(request, query, rowName, onOpenMessage);
  const typing = query.trim() !== "";
  // Conversation commands stay out until you type. Trunks stay listed when the field is empty, ahead of the other commands.
  const listed = typing ? rows : rows.filter((r) => !r.whenTyping);
  const base = filterPalette(listed, query);
  const ordered = typing ? base : [...base.filter((r) => r.group === "Trunks"), ...base.filter((r) => r.group !== "Trunks")];
  const shown = paletteShown(ordered, typing ? messages.rows : []);
  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  const run = (row: PaletteRow | undefined) => {
    if (row) {
      onClose();
      row.run();
    }
  };
  let lastGroup = "";
  const empty = paletteEmptyLine(shown.length, messages.searching);
  return (
    <div className="scrim palette-scrim in17" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Find anything" data-testid="palette">
        <label className="pal-field">
          <Icon name="search" />
          <input
            autoFocus
            aria-label="Find anything"
            placeholder="Find anything, or say what to do"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSel(moveSelection(sel, e.key === "ArrowDown" ? 1 : -1, shown.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[sel]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
        </label>
        {messages.note ? <p className="pal-note">{messages.note}</p> : null}
        <div className="pal-list" ref={listRef} role="listbox" aria-label="Results">
          {empty ? <p className="pal-none">{empty}</p> : null}
          {shown.map((row, i) => {
            const head = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            return (
              <div key={row.id}>
                {head ? <div className="ph">{head}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  className={i === sel ? "pal-row sel" : "pal-row"}
                  data-index={i}
                  data-testid="palette-row"
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(row)}
                >
                  <span className="pal-copy">
                    <span className="pal-label">{row.mark ? <BoldQuery text={row.label} query={row.mark} /> : row.label}</span>
                    {row.detail ? <span className="pal-detail">{row.detail}</span> : null}
                    {row.meta ? <span className="pal-meta">{row.meta}</span> : null}
                  </span>
                  <span className="pal-hint">{row.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
