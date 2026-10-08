// The saved layout (DESIGN-SPEC §3.3): sidebar width, rail and hidden state, kept on this computer.
import { useCallback, useEffect, useState } from "react";

export type Layout = { sideW: number; rail: boolean; hidden: boolean; focus: boolean };

export const SIDE_DEFAULT = 292;
export const SIDE_MIN = 220;
export const SIDE_MAX = 640;
const KEY = "branch.layout";
// The thread column sits beside a full contact list on a 1280 desktop. The face
// rail is only the default in the mid-width band; people who saved rail keep it.
const defaultRail = () => typeof matchMedia === "function" && matchMedia("(min-width: 761px) and (max-width: 999px)").matches;

export function readLayout(): Layout {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Layout>;
    const w = typeof r.sideW === "number" ? r.sideW : SIDE_DEFAULT;
    return { sideW: Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)), rail: r.rail === true || (localStorage.getItem(KEY) === null && defaultRail()), hidden: r.hidden === true, focus: false };
  } catch {
    return { sideW: SIDE_DEFAULT, rail: defaultRail(), hidden: false, focus: false }; // storage blocked or damaged
  }
}

/** Below 200 px the list snaps to the face rail; it never sits at a truncated intermediate width. */
export function dragResult(width: number): { sideW: number; rail: false } | { rail: true } | { hidden: true } {
  if (width < 40) {
    return { hidden: true };
  }
  if (width < 200) {
    return { rail: true };
  }
  return { sideW: Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(width))), rail: false };
}

/** The pinned v23 preview's list button: full ↔ rail, or hidden → full. */
export function toggleListLayout(layout: Layout): Partial<Layout> {
  return layout.hidden ? { hidden: false, rail: false } : { rail: !layout.rail };
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(readLayout);
  useEffect(() => {
    try {
      const { focus: _focus, ...kept } = layout;
      localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
      // storage blocked: the layout lasts for this window only
    }
  }, [layout]);
  const update = useCallback((patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch })), []);
  return [layout, update] as const;
}
