// The sidebar's own state: rows picked with Alt or Shift, the hover card's timing, and each row's extra marks.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Conversation } from "../connect/conversations";
import { loadDraft, safeStorage } from "../composer/drafts";
import { loadLine } from "../composer/queue";
import type { Level } from "../places-nav/settings-nav";
import type { RowExtras } from "./ConversationRow";

/** Select several (§4.1.1, the preview's SEL_PA18): Alt+Click adds or removes a row, Shift+Click extends from the
 *  last one picked; a plain click or Escape clears. The main conversation and child rows can't be picked. */
export function useSelection(order: () => Conversation[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const last = useRef<string | null>(null);
  const clear = useCallback(() => {
    last.current = null;
    setPicked((cur) => (cur.size ? new Set() : cur));
  }, []);
  const select = useCallback((row: Conversation, e: MouseEvent<HTMLElement>): boolean => {
    if (row.isMain) return true;
    const rows = order().filter((r) => !r.isMain);
    if (!rows.some((r) => r.key === row.key)) return true; // a child row or one not in the list
    setPicked((cur) => {
      const next = new Set(cur);
      const from = last.current ? rows.findIndex((r) => r.key === last.current) : -1;
      const to = rows.findIndex((r) => r.key === row.key);
      if (e.shiftKey && from >= 0) {
        rows.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((r) => next.add(r.key));
      } else if (!next.delete(row.key)) {
        next.add(row.key);
      }
      return next;
    });
    last.current = row.key;
    return true;
  }, [order]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".pop, .scrim")) clear();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [clear]);
  return { picked, select, clear };
}

/** The conversation card: it shows 600 ms after the pointer rests on a row, at once on keyboard focus, and goes on
 *  leave, a press anywhere or a scroll of the list. */
export function useRowCard(enabled: boolean) {
  const [card, setCard] = useState<{ row: Conversation; el: HTMLElement } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCard(null);
  }, []);
  const onCard = useCallback((row: Conversation, el: HTMLElement | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!el || !enabled) {
      setCard(null);
      return;
    }
    if (el.matches(":focus-within")) {
      setCard({ row, el });
      return;
    }
    timer.current = setTimeout(() => setCard({ row, el }), 600);
  }, [enabled]);
  useEffect(() => {
    const away = () => hide();
    const scroll = (e: Event) => (e.target as Element | null)?.closest?.(".side") && hide();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [hide]);
  return { card, onCard, hide };
}

/** Appearance's list switches (users.prefs ui.window.look, mirrored in localStorage "branch.look"). Swap this for
 *  face/look-prefs.ts useLookPrefs() once claude/win-r2-pages is merged. */
function readLook(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem("branch.look") ?? "{}") as { look?: Record<string, unknown> };
    return parsed.look ?? {};
  } catch {
    return {}; // storage blocked or damaged: every switch at its default
  }
}

export function useLookSwitches(): { headlines: boolean; liveInList: boolean; captions: boolean } {
  const [look, setLook] = useState(readLook);
  useEffect(() => {
    const changed = (e: Event) => {
      const detail = (e as CustomEvent<{ look?: Record<string, unknown> }>).detail;
      setLook(detail?.look ?? readLook());
    };
    window.addEventListener("branch:look-change", changed);
    return () => window.removeEventListener("branch:look-change", changed);
  }, []);
  return { headlines: look.headlines !== false, liveInList: look["show.live"] !== false, captions: look["ch.cap"] !== false };
}

/** Each row's extra marks: an unsent draft, messages waiting to send, and the level's badges. */
export function useRowExtras(openKey: string | null, level: Level, nameOf: (key: string) => string): (row: Conversation) => RowExtras {
  const look = useLookSwitches();
  return useCallback((row: Conversation) => {
    const storage = safeStorage();
    return {
      draft: row.key !== openKey && loadDraft(storage, row.key).trim().length > 0,
      waitingToSend: loadLine(storage, row.key).filter((i) => i.state !== "sending").length,
      advanced: level !== "regular",
      headlines: look.headlines,
      liveInList: look.liveInList,
      nameOf,
    };
  }, [openKey, level, nameOf, look.headlines, look.liveInList]);
}
