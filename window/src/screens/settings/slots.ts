// Settings pages that draw their own content. A page in the frame's nav can name a component; the frame keeps its nav,
// search, "How much to show" and Esc/Enter as on row pages, and hands the component the same live engine it uses. A
// page can also add rows to the row table, so search finds them; ids stay unique across the table and every page. A row
// page can instead keep its row cards and draw some rows itself (controls): a row whose source is "slot" is drawn by its
// page's control, in the row's place, with the row's label and help; without that control it is Coming.
import type { ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { PageId } from "./nav";
import type { Row } from "./rows";

/** What a page's own component gets: the frame's engine, and a way to open another Settings page. */
export type SlotPageProps = { engine: WindowEngine; onPage?: (page: PageId) => void };

/** What a page's own row control gets: the frame's engine, its row, and a way to open another Settings page. */
export type SlotControlProps = { engine: WindowEngine; row: Row; onPage?: (page: PageId) => void };
export type SlotControl = (props: SlotControlProps) => ReactNode;

export type PageSlot = {
  /** Draws the page in place of its row cards, with the frame's own engine. */
  component?: (props: SlotPageProps) => ReactNode;
  /** Rows this page adds to the table (for search and the level). Each row's page must be this page. */
  rows?: Row[];
  /** Controls this page draws itself, by row id: each in place of that row's control, under its label and help. */
  controls?: Record<string, SlotControl>;
};
export type PageSlots = Partial<Record<PageId, PageSlot>>;

/** The row table with every page's extra rows added, in order. Throws when an id is used twice or a page adds a row
 *  for another page: the table is keyed by stable ids, so a clash would open or save the wrong row. */
export function mergeRows(base: readonly Row[], pages: PageSlots = {}): Row[] {
  const from = new Map<string, string>();
  const out: Row[] = [];
  const add = (row: Row, where: string) => {
    const first = from.get(row.id);
    if (first) throw new Error(`Settings row id "${row.id}" is used twice (${first} and ${where}).`);
    from.set(row.id, where);
    out.push(row);
  };
  for (const row of base) add(row, "the row table");
  for (const [page, slot] of Object.entries(pages) as [PageId, PageSlot | undefined][]) {
    for (const row of slot?.rows ?? []) {
      if (row.page !== page) throw new Error(`Settings row "${row.id}" is on page "${row.page}" but page "${page}" adds it.`);
      add(row, `page "${page}"`);
    }
  }
  for (const [page, slot] of Object.entries(pages) as [PageId, PageSlot | undefined][]) {
    for (const id of Object.keys(slot?.controls ?? {})) {
      const row = out.find((r) => r.id === id);
      if (!row || row.page !== page) throw new Error(`Page "${page}" draws a control for row "${id}", which is not a row of that page.`);
    }
  }
  return out;
}
