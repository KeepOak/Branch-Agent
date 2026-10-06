export type PanelPlace = { corner: "bottom-right" | "bottom-left" | "top-right" | "top-left" } | { x: number; y: number };

export const USUAL_PLACE: PanelPlace = { corner: "bottom-right" };
const KEY = "branch.agent-window-place";

export function readPanelPlace(): PanelPlace {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
    if (value && typeof value === "object") {
      const place = value as { corner?: string; x?: number; y?: number };
      if (place.corner === "bottom-right" || place.corner === "bottom-left" || place.corner === "top-right" || place.corner === "top-left") return { corner: place.corner };
      if (typeof place.x === "number" && Number.isFinite(place.x) && typeof place.y === "number" && Number.isFinite(place.y)) return { x: Math.max(0, Math.min(1, place.x)), y: Math.max(0, Math.min(1, place.y)) };
    }
  } catch { /* A blocked or old layout uses the usual place. */ }
  return USUAL_PLACE;
}

export function savePanelPlace(place: PanelPlace): void {
  try { localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* Keep it for this window. */ }
}

export type PanelBounds = { left: number; top: number; right: number; bottom: number };
export function panelLimits(column: PanelBounds, width: number, height: number, composerTop?: number): PanelBounds {
  const left = column.left + 18;
  const top = column.top + 18;
  return {
    left,
    top,
    right: Math.max(left, column.right - 18 - width),
    bottom: Math.max(top, Math.min(column.bottom - 96, composerTop === undefined ? Infinity : composerTop - 12) - height),
  };
}

export function panelPoint(place: PanelPlace, limits: PanelBounds): { x: number; y: number } {
  if ("corner" in place) return {
    x: place.corner.endsWith("left") ? limits.left : limits.right,
    y: place.corner.startsWith("top") ? limits.top : limits.bottom,
  };
  return { x: limits.left + place.x * (limits.right - limits.left), y: limits.top + place.y * (limits.bottom - limits.top) };
}

export function panelPlaceAt(x: number, y: number, limits: PanelBounds): PanelPlace {
  return {
    x: limits.right === limits.left ? 0 : Math.max(0, Math.min(1, (x - limits.left) / (limits.right - limits.left))),
    y: limits.bottom === limits.top ? 0 : Math.max(0, Math.min(1, (y - limits.top) / (limits.bottom - limits.top))),
  };
}
