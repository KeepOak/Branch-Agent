import { useLayoutEffect, useRef, type RefObject } from "react";

/** Preview TZ2-nav.js `navGoT5` retries after render, when the scroller may not exist yet. */
const RESTORE_MS = [160, 420] as const;
/** Chat history can arrive after 420 ms; keep watching `scrollHeight` (the overflow box does not resize). */
const WATCH_MS = 2000;
const WATCH_EVERY_MS = 32;
/** Same near-end distance the thread uses to keep following the latest message. */
const NEAR_END_PX = 80;

type BranchHistoryState = {
  branchIndex?: number;
  branchRoute?: unknown;
};

type SavedScroll = {
  y: number;
  atEnd: boolean;
};

const saved = new Map<string, SavedScroll>();
let nextIsPop = false;

function branchState(state: unknown): BranchHistoryState {
  return state && typeof state === "object" ? (state as BranchHistoryState) : {};
}

/** One history entry: the shell's `branchIndex` plus the route it pushed. */
export function historyEntryKey(state: unknown = history.state): string {
  const entry = branchState(state);
  return `${Number(entry.branchIndex) || 0}:${JSON.stringify(entry.branchRoute ?? null)}`;
}

function atEndOf(el: HTMLElement, atEnd?: RefObject<boolean>): boolean {
  if (atEnd) return atEnd.current;
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END_PX;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    nextIsPop = true;
  });
}

function takePop(): boolean {
  if (!nextIsPop) return false;
  nextIsPop = false;
  return true;
}

/** Clears module state between tests. */
export function resetScrollMemoryForTests(): void {
  saved.clear();
  nextIsPop = false;
}

export type ScrollMemoryOptions = {
  /** Thread follow flag: saved on scroll, restored after Back/Forward. */
  atEnd?: RefObject<boolean>;
};

/** Watch children and `scrollHeight` — not the overflow element's border box. */
function watchContent(ref: RefObject<HTMLElement | null>, put: () => boolean): () => void {
  let stopped = false;
  let lastHeight = -1;
  let interval = 0;
  const seen = new Set<Element>();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
    mo?.disconnect();
    ro?.disconnect();
  };
  const ro = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
        if (!stopped) check();
      })
    : null;
  const mo = typeof MutationObserver === "function"
    ? new MutationObserver(() => {
        if (!stopped) check();
      })
    : null;
  const observeChildren = (el: HTMLElement) => {
    if (!ro) return;
    for (const child of el.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      ro.observe(child);
    }
  };
  const check = () => {
    if (stopped) return;
    const el = ref.current;
    if (!el) return;
    observeChildren(el);
    if (el.scrollHeight !== lastHeight || lastHeight < 0) lastHeight = el.scrollHeight;
    if (put()) stop();
  };
  const attach = () => {
    const el = ref.current;
    if (!el) return;
    mo?.observe(el, { childList: true, subtree: true });
    observeChildren(el);
    check();
  };
  interval = window.setInterval(() => {
    if (!stopped) attach();
  }, WATCH_EVERY_MS);
  attach();
  return stop;
}

/**
 * Remembers the scroller for the current history entry and puts it back after
 * Back/Forward, the way preview `recordNavT5` / `navGoT5` keep `y`.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, opts?: ScrollMemoryOptions): void {
  const key = historyEntryKey();
  const atEndRef = useRef(opts?.atEnd);
  atEndRef.current = opts?.atEnd;

  useLayoutEffect(() => {
    const popped = takePop();
    const timers: number[] = [];
    let stopWatch: (() => void) | undefined;
    const flag = atEndRef.current;
    if (popped) {
      const entry = saved.get(key);
      if (entry) {
        if (flag) flag.current = entry.atEnd;
        let placed = false;
        const put = () => {
          const el = ref.current;
          // A chat left at the end keeps following; pinning the old y would fight new tokens.
          if (!el || entry.atEnd) return false;
          // A successful restore must not pin again after a hand scroll.
          if (placed) return true;
          el.scrollTop = entry.y;
          // Setting scrollTop can fire `scroll` and mark a still-short scroller as at the end.
          if (flag) flag.current = entry.atEnd;
          const ok = el.scrollHeight - el.clientHeight >= entry.y;
          if (ok) placed = true;
          return ok;
        };
        requestAnimationFrame(put);
        for (const ms of RESTORE_MS) timers.push(window.setTimeout(put, ms));
        // The overflow box stays the same size; history/lists grow children and scrollHeight.
        stopWatch = watchContent(ref, put);
        timers.push(window.setTimeout(() => stopWatch?.(), WATCH_MS));
      }
    } else if (flag) {
      // Thread stays mounted across chats; a fresh open must follow the end again.
      flag.current = true;
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
      stopWatch?.();
      // Strict Mode remounts with the same entry; a real navigation already changed history.state.
      if (popped && historyEntryKey() === key) nextIsPop = true;
    };
  }, [key, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const last = { y: el.scrollTop, atEnd: atEndOf(el, atEndRef.current) };
    const capture = () => {
      last.y = el.scrollTop;
      last.atEnd = atEndOf(el, atEndRef.current);
    };
    const flush = () => {
      saved.set(key, { y: last.y, atEnd: last.atEnd });
    };
    const onScroll = () => {
      capture();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        flush();
      });
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      // Flush this entry's last y even if history.state already moved (scroll-then-click in one frame).
      flush();
    };
  }, [key, ref]);
}
