// The R1 conversation's rows when other Trunks, people or outside agents write in it (DESIGN-SPEC §4.2.4). The
// Classic room fold (rooms/fold.ts foldTalks) runs first, as the Classic thread runs it; every item it keeps goes
// through the R1 grouping (entriesOf), and each folded exchange stays one "talked it through" row between them.
import type { Item } from "../../thread/layout";
import type { TalkItem, RoomItem } from "../../rooms/fold";
import { entriesOf, type Entry } from "./chat-logic";

export type RoomEntry = Entry | { type: "talk"; key: string; talk: TalkItem };

export function roomEntries(items: readonly RoomItem[]): RoomEntry[] {
  const out: RoomEntry[] = [];
  let run: Item[] = [];
  const flush = () => {
    if (run.length) out.push(...entriesOf(run));
    run = [];
  };
  for (const item of items) {
    if (item.type === "talk") {
      flush();
      out.push({ type: "talk", key: item.key, talk: item });
    } else run.push(item);
  }
  flush();
  return out;
}
