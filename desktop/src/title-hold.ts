/**
 * Keeps each Branch window's native title (title bar, Window menu, Dock) steady while an update swaps the engine.
 * The window reconnects to the new engine and, for a moment, its page title says "(Offline)" or names the default
 * Trunk while its lists reload. The native title keeps what it showed until the page title, connected again, stays
 * put for TITLE_SETTLE_MS after the update: then it shows that title (usually the one it held all along).
 */
type TitleListener = (event: { preventDefault(): void }, title: string) => void;
export interface TitledWindow {
  getTitle(): string;
  setTitle(title: string): void;
  isDestroyed(): boolean;
  on(event: "page-title-updated", listener: TitleListener): unknown;
  off(event: "page-title-updated", listener: TitleListener): unknown;
}

/** A new page title must stay unchanged this long after the update before the native title takes it. */
export const TITLE_SETTLE_MS = 3_000;
/** Never hold longer than this after the update ends: the latest page title then shows, whatever it is. */
export const TITLE_HOLD_MAX_MS = 60_000;
/** windowTitle() in window/src/places-nav/routes.ts puts this in front while the window is not connected. */
export const OFFLINE_TITLE_PREFIX = "(Offline) ";

type Timer = ReturnType<typeof setTimeout>;

export function createTitleHold<W extends TitledWindow>(options: {
  windows(): W[];
  /** The native title for a page title (the test copy prefixes one). */
  show?(title: string): string;
  settleMs?: number;
  maxMs?: number;
  setTimer?(run: () => void, ms: number): Timer;
  clearTimer?(timer: Timer): void;
}) {
  const show = options.show ?? ((title: string) => title);
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => { const timer = setTimeout(run, ms); timer.unref?.(); return timer; });
  const clearTimer = options.clearTimer ?? clearTimeout;
  const settleMs = options.settleMs ?? TITLE_SETTLE_MS;
  const maxMs = options.maxMs ?? TITLE_HOLD_MAX_MS;
  interface Hold {
    shown: string;
    latest?: string;
    releasing: boolean;
    settle?: Timer;
    cap?: Timer;
    listener: TitleListener;
  }
  const holds = new Map<W, Hold>();

  const finish = (w: W, title?: string) => {
    const hold = holds.get(w);
    if (!hold) return;
    holds.delete(w);
    if (hold.settle) clearTimer(hold.settle);
    if (hold.cap) clearTimer(hold.cap);
    if (w.isDestroyed()) return;
    w.off("page-title-updated", hold.listener);
    if (title !== undefined && show(title) !== w.getTitle()) w.setTitle(show(title));
  };
  const evaluate = (w: W) => {
    const hold = holds.get(w);
    if (!hold?.releasing) return;
    if (hold.settle) { clearTimer(hold.settle); hold.settle = undefined; }
    // Still reconnecting: keep holding until the page is connected again (or the cap).
    if (hold.latest?.startsWith(OFFLINE_TITLE_PREFIX)) return;
    // Connected (or not yet disconnected: a handoff moves the window after the swap): wait for a quiet spell, since
    // the lists reload after the reconnect and the name can flip to the default Trunk and back.
    hold.settle = setTimer(() => finish(w, hold.latest), settleMs);
  };

  return {
    /** True while the title of `w` is held. */
    holding(w: W): boolean { return holds.has(w); },
    /** Holds every open window's title; the returned function (idempotent) ends the hold once each page settles. */
    hold(): () => void {
      const held: W[] = [];
      for (const w of options.windows()) {
        if (w.isDestroyed() || holds.has(w)) continue;
        const hold: Hold = {
          shown: w.getTitle(),
          releasing: false,
          listener: (event, title) => {
            event.preventDefault();
            hold.latest = title;
            evaluate(w);
          },
        };
        holds.set(w, hold);
        w.on("page-title-updated", hold.listener);
        held.push(w);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const w of held) {
          const hold = holds.get(w);
          if (!hold) continue;
          hold.releasing = true;
          hold.cap = setTimer(() => finish(w, hold.latest), maxMs);
          evaluate(w);
        }
      };
    },
  };
}
