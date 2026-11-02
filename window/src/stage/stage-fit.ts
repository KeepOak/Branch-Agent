import { useEffect, useState } from "react";

/** The narrowest the conversation gets beside an open Computer or Browser stage: its chips and composer still fit (DA-72). */
export const CHAT_MIN_BESIDE = 600;
/** The narrowest stage worth showing beside the conversation (its header fits on one row); below this it opens as a
 *  sheet over the thread instead. */
export const STAGE_MIN_BESIDE = 600;
/** The narrowest page the Trunk's browser shows (#1103): a page lays out as on a small laptop, not a phone, so it stays
 *  readable in a window snapped to half a screen beside Chrome. */
export const BROWSER_PAGE_MIN = 720;
/** The face rail's width, the list's narrowest form. */
const RAIL_WIDTH = 68;
/** The share of the window the stage takes when there is room for more (the preview's 58vw). */
const STAGE_SHARE = 0.58;

export type StageFit = { mode: "beside"; width: number } | { mode: "sheet" };

/**
 * Where an open stage goes for a window this wide with a sidebar this wide. Beside the conversation when both keep a
 * usable width; otherwise a sheet over the thread, so the conversation's composer keeps the full column (DA-72).
 */
export function stageFit(windowWidth: number, sideWidth: number, stageMin = STAGE_MIN_BESIDE): StageFit {
  const room = windowWidth - Math.max(0, sideWidth) - CHAT_MIN_BESIDE;
  const width = Math.floor(Math.min(windowWidth * STAGE_SHARE, room));
  return width >= stageMin ? { mode: "beside", width } : { mode: "sheet" };
}

/**
 * Where the open Trunk's browser goes (#1103). It sits beside the conversation only when its page keeps
 * BROWSER_PAGE_MIN; otherwise it covers the thread. When the full list would still leave the page narrower than that
 * (a window snapped to half a screen), the list shows as the face rail while the browser is open, without saving it.
 * `narrow` is the phone layout, where the list slides over the page instead of taking room.
 */
export function browserFit(windowWidth: number, sideWidth: number, narrow = false): { fit: StageFit; rail: boolean; page: number } {
  const side = narrow ? 0 : Math.max(0, sideWidth);
  const rail = side > RAIL_WIDTH && windowWidth - side < BROWSER_PAGE_MIN;
  const list = rail ? RAIL_WIDTH : side;
  const fit = stageFit(windowWidth, list, BROWSER_PAGE_MIN);
  return { fit, rail, page: fit.mode === "beside" ? fit.width : windowWidth - list };
}

/** The window's width, following resizes. */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return width;
}
