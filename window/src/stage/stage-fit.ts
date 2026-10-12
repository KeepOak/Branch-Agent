import { useEffect, useState } from "react";

/** The narrowest the conversation gets beside an open Computer or Browser stage: its chips and composer still fit (DA-72). */
export const CHAT_MIN_BESIDE = 600;
/** The narrowest stage worth showing beside the conversation (its header fits on one row); below this it opens as a
 *  sheet over the thread instead. */
export const STAGE_MIN_BESIDE = 600;
/** The share of the window the stage takes when there is room for more (the preview's 58vw). */
export const STAGE_SHARE = 0.58;

export type StageFit = { mode: "beside"; width: number } | { mode: "sheet" };

/**
 * Where an open stage goes for a window this wide with a sidebar this wide. Beside the conversation when both keep a
 * usable width; otherwise a sheet over the thread, so the conversation's composer keeps the full column (DA-72).
 */
export function stageFit(windowWidth: number, sideWidth: number): StageFit {
  const room = windowWidth - Math.max(0, sideWidth) - CHAT_MIN_BESIDE;
  const width = Math.floor(Math.min(windowWidth * STAGE_SHARE, room));
  return width >= STAGE_MIN_BESIDE ? { mode: "beside", width } : { mode: "sheet" };
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
