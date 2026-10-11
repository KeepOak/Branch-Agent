// Which side-panel tabs fit the tab row. The rest go into a "More" menu, so no label is cut off at the pane's width.
export const TAB_GAP = 2;
/** Room for the More button itself, in px. */
export const MORE_TAB_WIDTH = 56;

export type TabFit<T extends string> = { visible: T[]; overflow: T[] };

/**
 * `widths` holds each tab's measured width in px (a tab not measured yet counts as 0, so it shows).
 * The current tab always stays visible: if it would overflow, it takes the last visible slot.
 */
export function fitTabs<T extends string>(tabs: readonly T[], widths: Readonly<Partial<Record<T, number>>>, available: number, current: T): TabFit<T> {
  const needed = (list: readonly T[]) => list.reduce((sum, t) => sum + (widths[t] ?? 0), 0) + TAB_GAP * Math.max(0, list.length - 1);
  // Before the row is measured (width 0) every tab shows; the row is measured right after it first paints.
  if (available <= 0 || needed(tabs) <= available) return { visible: [...tabs], overflow: [] };
  let count = 0;
  while (count < tabs.length && needed(tabs.slice(0, count + 1)) + TAB_GAP + MORE_TAB_WIDTH <= available) count += 1;
  const visible = tabs.slice(0, count);
  if (tabs.includes(current) && !visible.includes(current) && visible.length > 0) visible[visible.length - 1] = current;
  return { visible, overflow: tabs.filter((t) => !visible.includes(t)) };
}
