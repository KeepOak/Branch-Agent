// The conversation ⋯ menu's room rows (DESIGN-SPEC §4.2.7 "Rooms, in place of the Trunk rows"): Rename group, Group
// rules (the current rule on the right), a separator, Leave and archive, then Delete…. Rows the engine can't do yet
// are not drawn: the greyed "Add a Trunk" row and the working-together patterns were removed.
// TODO(engine-lane): the greyed Who answers reasons in room-rules.tsx say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { MenuItem } from "../shell/Menu";
import { menuIcon } from "../shell/menu-icons";

const NO_METHOD = "needs an engine method Branch doesn't have yet.";
export const ROOM_REASONS = {
  lead: `A lead Trunk choosing who answers ${NO_METHOD}`,
  whoAnswers: `Choosing who answers outside a chat-app group ${NO_METHOD}`,
  everyone: `Starting every Trunk in a Branch group ${NO_METHOD}`,
  mentions: `Starting the mentioned Trunks in a Branch group ${NO_METHOD}`,
} as const;

export type RoomMenuRun = { rename: () => void; rules: () => void; leave: () => void; remove: () => void };

/** The room rows; `canLeave` is false for the default Trunk's main conversation, which can't be archived or deleted. */
export function roomMenuItems(p: { ruleWords: string | null; canLeave: boolean; run: RoomMenuRun }): MenuItem[] {
  const items: MenuItem[] = [
    { label: "Rename group", icon: menuIcon("edit"), run: p.run.rename },
    { label: "Group rules", icon: menuIcon("sliders"), run: p.run.rules, ...(p.ruleWords ? { hint: p.ruleWords } : {}) },
    { kind: "sep" },
  ];
  if (p.canLeave) {
    items.push({ label: "Leave and archive", icon: menuIcon("trash"), run: p.run.leave }, { kind: "sep" }, { label: "Delete…", icon: menuIcon("trash"), run: p.run.remove, danger: true });
  }
  return items;
}
