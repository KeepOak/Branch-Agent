import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../connect/conversations";
import { Pebble } from "../face/Pebble";
import { Icon } from "./icons";
import { rowTime } from "./list-model";
import {
  CHIPS,
  countOf,
  cutAround,
  markParts,
  matchConversations,
  readFileHits,
  readMessageHits,
  type SearchChip,
  type SearchResults,
} from "./search-model";

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

const EMPTY: SearchResults = { chats: [], messages: [], past: [], files: [] };

/** The engine half of search: messages through sessions.search, files and memory through memory.search. */
export function useSearch(request: Request, rows: Conversation[], trunkName: (id: string | undefined) => string) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<SearchChip>("all");
  const [remote, setRemote] = useState<Pick<SearchResults, "messages" | "files">>({ messages: [], files: [] });
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRemote({ messages: [], files: [] });
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      const scope = { includeGlobal: true, includeUnknown: true, configuredAgentsOnly: true, archived: "all" };
      // Each source shows as soon as it answers; memory search can be slow while its index is repaired.
      request("sessions.search", { query: q, limit: 25, scope }).then(
        (r) => current && setRemote((x) => ({ ...x, messages: readMessageHits(r) })),
        () => current && setRemote((x) => ({ ...x, messages: [] })),
      );
      request("memory.search", { query: q }).then(
        (r) => current && setRemote((x) => ({ ...x, files: readFileHits(r) })),
        () => current && setRemote((x) => ({ ...x, files: [] })),
      );
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, request]);
  const local = query.trim() ? matchConversations(rows, query, trunkName) : { chats: [], past: [] };
  const results: SearchResults = query.trim() ? { ...local, ...remote } : EMPTY;
  const change = (next: string) => {
    if (!query && next) {
      setChip("all"); // typing into an empty field resets the filter (§4.1.2 States)
    }
    setQuery(next);
  };
  return { query, setQuery: change, chip, setChip, results };
}

type BoxProps = { query: string; onQuery: (q: string) => void; rail?: boolean };

/** The search field (§4.1.2 Field, Shortcut hint, Clear). Escape empties it and brings the list back. */
export function SearchBox({ query, onQuery }: BoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <label className="search" data-testid="search" title="Search chats, Trunks, messages and past sessions">
      <Icon name="search" small />
      <input
        ref={ref}
        placeholder="Search"
        aria-label="Search chats, Trunks, messages and past sessions"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onQuery("");
            ref.current?.blur();
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear the search"
          onClick={(e) => {
            e.preventDefault();
            onQuery("");
            ref.current?.focus();
          }}
        >
          <Icon name="x" size={12} />
        </button>
      ) : (
        <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
      )}
    </label>
  );
}

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {markParts(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

type ResultsProps = {
  query: string;
  chip: SearchChip;
  results: SearchResults;
  now: number;
  trunkName: (id: string | undefined) => string;
  rowName: (key: string) => string;
  onChip: (c: SearchChip) => void;
  onOpen: (key: string) => void;
  onLibrary: () => void;
};

function ChatResult({ row, p }: { row: Conversation; p: ResultsProps }) {
  return (
    <button type="button" className="sr" data-testid="search-result" data-key={row.key} onClick={() => p.onOpen(row.key)}>
      <Pebble size={34} label={p.trunkName(row.agentId)} />
      <span className="sr-body">
        <b className="sr-title">
          <Marked text={row.isMain ? p.trunkName(row.agentId) : row.title || "New conversation"} q={p.query} />
        </b>
        <span className="sr-snip">{row.archived ? "Archived" : p.trunkName(row.agentId)}</span>
      </span>
    </button>
  );
}

/** The results that replace the list while searching (§4.1.2): chips, sections, highlighted matches. */
export function SearchResultsView(p: ResultsProps) {
  const { results, chip, query } = p;
  const total = countOf(results, "all");
  const show = (s: SearchChip) => (chip === "all" || chip === s) && countOf(results, s) > 0;
  return (
    <div className="side-scroll search-results" data-testid="search-results">
      <div className="chips" role="tablist" aria-label="Search filters">
        {CHIPS.map((c) => {
          const n = countOf(results, c.id);
          return (
            <button key={c.id} type="button" role="tab" aria-selected={chip === c.id} className="chip" data-chip={c.id} onClick={() => p.onChip(c.id)}>
              {c.name}
              {n > 0 ? <em>{n}</em> : null}
            </button>
          );
        })}
      </div>
      {show("chats") ? <div className="lh">Chats and Trunks</div> : null}
      {show("chats") ? results.chats.map((r) => <ChatResult key={r.key} row={r} p={p} />) : null}
      {show("messages") ? <div className="lh">Messages</div> : null}
      {show("messages")
        ? results.messages.map((m) => (
            <button key={m.messageId || `${m.key}:${m.at}`} type="button" className="sr" data-testid="search-result" data-key={m.key} onClick={() => p.onOpen(m.key)}>
              <Pebble size={34} label={p.trunkName(undefined)} />
              <span className="sr-body">
                <b className="sr-title">
                  <span>{p.rowName(m.key)}</span>
                  <time>{rowTime(m.at, p.now)}</time>
                </b>
                <span className="sr-snip">
                  <span className="sr-from">{m.role === "user" ? "You:" : `${p.trunkName(undefined)}:`} </span>
                  <Marked text={cutAround(m.snippet, query)} q={query} />
                </span>
              </span>
            </button>
          ))
        : null}
      {show("past") ? <div className="lh">Past sessions</div> : null}
      {show("past") ? results.past.map((r) => <ChatResult key={r.key} row={r} p={p} />) : null}
      {show("files") ? <div className="lh">Files and memory</div> : null}
      {show("files")
        ? results.files.map((f, i) => (
            <button key={`${f.title}:${i}`} type="button" className="sr" data-testid="search-result" onClick={p.onLibrary}>
              <span className="sr-tile">
                <Icon name="book" small />
              </span>
              <span className="sr-body">
                <b className="sr-title">{f.title}</b>
                <span className="sr-snip">
                  <Marked text={cutAround(f.snippet, query)} q={query} />
                </span>
              </span>
            </button>
          ))
        : null}
      {total === 0 ? (
        <div className="sr-none">
          No chats, messages or files with “{query}”.
          <br />
          <button type="button" className="link" onClick={() => p.onChip("past")}>
            Look in past sessions
          </button>
        </div>
      ) : null}
    </div>
  );
}
