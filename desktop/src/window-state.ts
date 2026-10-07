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

/** Saves maximized/normal state, the normal bounds and the display on every move, resize and close. */
export function trackWindowState(w: BrowserWindow, dataDir: string, displayFor: (bounds: Rectangle) => Rectangle, file = FILE): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (w.isDestroyed() || w.isMinimized()) return;
    const bounds = w.getNormalBounds();
    const state: SavedWindowState = { mode: w.isMaximized() ? "maximized" : "normal", ...bounds, display: displayFor(bounds) };
    try {
      writeFileSync(join(dataDir, file), JSON.stringify(state));
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
