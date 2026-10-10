// Remembers the main window's state the way VS Code's window state does: maximized or normal bounds plus the
// display it was on. First launch opens maximized; a saved display that is gone falls back to maximized.
import type { BrowserWindow, Rectangle } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SavedWindowState = { mode: "maximized" | "normal"; x: number; y: number; width: number; height: number; display?: Rectangle };
export type WindowPlacement = { maximized: boolean; bounds?: Rectangle };
type DisplayLike = { bounds: Rectangle; workArea: Rectangle };

const FILE = "window-state.json";
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const SAVE_DELAY_MS = 500;

const sameRect = (a: Rectangle, b: Rectangle): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const finite = (...n: unknown[]): boolean => n.every((v) => typeof v === "number" && Number.isFinite(v));

/** Reads the saved state; anything missing or malformed counts as a first launch. */
export function readWindowState(dataDir: string, file = FILE): SavedWindowState | undefined {
  try {
    const s = JSON.parse(readFileSync(join(dataDir, file), "utf8")) as SavedWindowState;
    if ((s.mode === "maximized" || s.mode === "normal") && finite(s.x, s.y, s.width, s.height)) return s;
  } catch {
    // first launch or unreadable file
  }
  return undefined;
}

/** Where the window opens: the saved bounds only when the display it was on is still attached (VS Code's validation). */
export function placeWindow(saved: SavedWindowState | undefined, displays: DisplayLike[]): WindowPlacement {
  if (!saved) return { maximized: true };
  const display = displays.find((d) => (saved.display ? sameRect(d.bounds, saved.display) : false));
  if (!display) return { maximized: true };
  const area = display.workArea;
  const width = Math.max(MIN_WIDTH, Math.min(saved.width, area.width));
  const height = Math.max(MIN_HEIGHT, Math.min(saved.height, area.height));
  // Keep the whole window on that display's work area.
  const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
  return { maximized: saved.mode === "maximized", bounds: { x, y, width, height } };
}

const overlap = (a: Rectangle, b: Rectangle): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const gap = (a: Rectangle, b: Rectangle): number =>
  Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));

/**
 * Bounds that keep a window wholly inside the work area of the display it mostly covers (the nearest display when it
 * covers none, as after unplugging a monitor); undefined when it already fits. Shrinks only when it is bigger than that area.
 */
export function fitOnScreen(bounds: Rectangle, displays: DisplayLike[]): Rectangle | undefined {
  if (!displays.length) return undefined;
  const best = displays.reduce((a, b) => {
    const oa = overlap(bounds, a.workArea);
    const ob = overlap(bounds, b.workArea);
    if (oa !== ob) return ob > oa ? b : a;
    return gap(bounds, b.workArea) < gap(bounds, a.workArea) ? b : a;
  });
  const area = best.workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  const next = { x, y, width, height };
  return sameRect(next, bounds) ? undefined : next;
}

type ScreenLike = {
  getAllDisplays(): DisplayLike[];
  on(event: "display-added" | "display-removed" | "display-metrics-changed", fn: () => void): unknown;
  removeListener(event: "display-added" | "display-removed" | "display-metrics-changed", fn: () => void): unknown;
};
type FittableWindow = Pick<BrowserWindow, "isDestroyed" | "isMinimized" | "isMaximized" | "isFullScreen" | "getBounds" | "setBounds">;
const DISPLAY_EVENTS = ["display-added", "display-removed", "display-metrics-changed"] as const;
const DISPLAY_SETTLE_MS = 300;

/**
 * Keeps every window inside the visible screen after a display is added, removed or changes resolution or scaling.
 * Returns fit() to run once a window is shown (launch), with stop() to remove the listeners. Full-screen, maximized and
 * minimized windows are left to the system. defer lets the OS finish its own move before the windows are checked.
 */
export function keepWindowsOnScreen(
  screen: ScreenLike,
  windows: () => FittableWindow[],
  defer: (fn: () => void) => void = (fn) => { setTimeout(fn, DISPLAY_SETTLE_MS); },
): (() => void) & { stop: () => void } {
  const fitAll = (): void => {
    const displays = screen.getAllDisplays();
    if (!displays.length) return;
    for (const w of windows()) {
      if (w.isDestroyed() || w.isMinimized() || w.isFullScreen() || w.isMaximized()) continue;
      const next = fitOnScreen(w.getBounds(), displays);
      if (next) w.setBounds(next);
    }
  };
  const onChange = (): void => defer(fitAll);
  for (const event of DISPLAY_EVENTS) screen.on(event, onChange);
  return Object.assign(fitAll, { stop: () => { for (const event of DISPLAY_EVENTS) screen.removeListener(event, onChange); } });
}

/** Saves maximized/normal state, the normal bounds and the display on every move, resize and close. */
export function trackWindowState(w: BrowserWindow, dataDir: string, displayFor: (bounds: Rectangle) => Rectangle, file: string | (() => string) = FILE): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (w.isDestroyed() || w.isMinimized()) return;
    const bounds = w.getNormalBounds();
    const state: SavedWindowState = { mode: w.isMaximized() ? "maximized" : "normal", ...bounds, display: displayFor(bounds) };
    try {
      writeFileSync(join(dataDir, typeof file === "function" ? file() : file), JSON.stringify(state));
    } catch {
      // saving the window state must never stop the app
    }
  };
  const later = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  w.on("resize", later);
  w.on("move", later);
  w.on("maximize", save);
  w.on("unmaximize", save);
  w.on("close", save);
}
