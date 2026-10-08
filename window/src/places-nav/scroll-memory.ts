import { useLayoutEffect, useRef, type RefObject } from "react";

/** Preview TZ2-nav.js `navGoT5` retries after render, when the scroller may not exist yet. */
const RESTORE_MS = [160, 420] as const;
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

function remember(el: HTMLElement, key: string, atEnd?: RefObject<boolean>): void {
  saved.set(key, { y: el.scrollTop, atEnd: atEndOf(el, atEnd) });
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
        const put = () => {
          const el = ref.current;
          // A chat left at the end keeps following; pinning the old y would fight new tokens.
          if (!el || entry.atEnd) return false;
          el.scrollTop = entry.y;
          // Setting scrollTop can fire `scroll` and mark a still-short scroller as at the end.
          if (flag) flag.current = entry.atEnd;
          return el.scrollHeight - el.clientHeight >= entry.y;
        };
        requestAnimationFrame(put);
        for (const ms of RESTORE_MS) timers.push(window.setTimeout(put, ms));
        // Chat history can arrive after 420 ms; put again when the scroller grows.
        const scroller = ref.current;
        if (scroller && typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => {
            if (put()) ro.disconnect();
          });
          ro.observe(scroller);
          stopWatch = () => ro.disconnect();
          timers.push(window.setTimeout(stopWatch, 2000));
        }
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
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        remember(el, key, atEndRef.current);
      });
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      remember(el, key, atEndRef.current);
    };
  }, [key, ref]);
}
