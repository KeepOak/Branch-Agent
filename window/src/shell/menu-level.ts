import type { MenuItem } from "./Menu";
import { isComingWhy } from "./shown-why";

/** A menu's items at the level in use: an item greyed as Coming (its reason says it "comes in a later update", or is one
 *  of `coming`, the developer notes of items that wait on the engine) shows only at Technical (Private #1093 item 4),
 *  like Coming rows in Settings. An item greyed for a real condition stays, with its reason. Separators left at an end or
 *  next to each other close up. */
export function menuAtLevel(items: MenuItem[], technical: boolean, coming: readonly string[] = []): MenuItem[] {
  if (technical) return items;
  const isComing = (why: string | undefined) => isComingWhy(why) || (why !== undefined && coming.includes(why));
  const kept = items.filter((it) => !((it.kind === undefined || it.kind === "item") && isComing(it.disabled)));
  return kept.filter((it, i) => it.kind !== "sep" || (i > 0 && i < kept.length - 1 && kept[i + 1].kind !== "sep"));
}
