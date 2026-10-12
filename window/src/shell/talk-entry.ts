// DA-16: one visible way to open the default Trunk beside a page. The sidebar footer carries it whenever the
// list is on screen; the top bar's "Ask <Trunk>" stands in only while the list is hidden, so the two never show
// side by side. Settings keeps its own top-bar "?" (page help), which is a different action.

export type SideState = {
  /** The window is one popped-out conversation and draws no list. */
  dedicated: boolean;
  /** Focus mode hides the list. */
  focus: boolean;
  narrow: boolean;
  /** Narrow windows: the list slides in over the page. */
  slideOpen: boolean;
  /** Wide windows: the list is hidden (Ctrl B). The rail still shows its footer. */
  hidden: boolean;
};

/** Whether the sidebar, with its footer talk button, is on screen. */
export function sideShown(s: SideState): boolean {
  if (s.dedicated || s.focus) return false;
  return s.narrow ? s.slideOpen : !s.hidden;
}

/** The talk entry for the top bar: only when the sidebar's own button is out of sight. */
export function topBarTalk<T>(entry: T | null, side: SideState): T | null {
  return sideShown(side) ? null : entry;
}
