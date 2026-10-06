// Find in this conversation (DESIGN-SPEC §4.2.6 "Find bar", "Hits"; Keyboard: Ctrl+F opens or focuses it,
// Enter goes to the next hit, Shift+Enter to the previous, Escape closes). Hits are marked with the CSS Custom
// Highlight API, so the thread's DOM is never rewritten.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon, ICONS } from "./icons";

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): { reg: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Highlight ? { reg: css.highlights, Highlight } : null;
}

/** Every case-insensitive match of `query` in the thread's text, as ranges in reading order. */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase();
    for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function useHighlights(ranges: Range[], current: number): void {
  useEffect(() => {
    const api = registry();
    if (!api) return;
    api.reg.set("find-hit", new api.Highlight(...ranges));
    if (ranges[current]) {
      api.reg.set("find-current", new api.Highlight(ranges[current]));
      ranges[current].startContainer.parentElement?.scrollIntoView({ block: "center" });
    }
    return () => {
      api.reg.delete("find-hit");
      api.reg.delete("find-current");
    };
  }, [ranges, current]);
}

export function FindBar({ root, name, onClose, signature, initialQuery = "" }: { root: RefObject<HTMLElement | null>; name: string; onClose: () => void; signature: string; initialQuery?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [current, setCurrent] = useState(0);
  const [ranges, setRanges] = useState<Range[]>([]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    setRanges(root.current ? findRanges(root.current, query) : []);
    setCurrent(0);
  }, [query, root, signature]);
  useHighlights(ranges, current);
  const step = (d: number) => ranges.length && setCurrent((c) => (c + d + ranges.length) % ranges.length);
  const count = !query.trim() ? "" : ranges.length ? `${current + 1} of ${ranges.length}` : "No matches";
  return (
    <div className="find-bar" role="search" data-testid="find-bar">
      <Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
      <input
        ref={input}
        value={query}
        placeholder={`Find in ${name}`}
        aria-label={`Find in ${name}`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="find-count" data-testid="find-count">{count}</span>
      <button type="button" className="icon-sm" aria-label="Previous" title="Previous" disabled={!ranges.length} onClick={() => step(-1)}>
        <Icon d="M6 15l6-6 6 6" />
      </button>
      <button type="button" className="icon-sm" aria-label="Next" title="Next" disabled={!ranges.length} onClick={() => step(1)}>
        <Icon d="M6 9l6 6 6-6" />
      </button>
      <button type="button" className="icon-sm" aria-label="Close find" title="Close find" onClick={onClose}>
        <Icon d={ICONS.x} />
      </button>
    </div>
  );
}

/** Ctrl+F (⌘F) opens or focuses find in this conversation. */
export function useFindKey(open: (query?: string) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        open();
        document.querySelector<HTMLInputElement>(".find-bar input")?.focus();
      }
    };
    // The header's "Find in this conversation" button asks for it too.
    const onAsk = (event: Event) => {
      const query = (event as CustomEvent<{ query?: string }>).detail?.query;
      open(query);
      setTimeout(() => document.querySelector<HTMLInputElement>(".find-bar input")?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(FIND_EVENT, onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(FIND_EVENT, onAsk);
    };
  }, [open]);
}

/** Opens the find bar from outside the thread (the header's search button, §4.2.1). */
export const FIND_EVENT = "branch:find-in-conversation";
