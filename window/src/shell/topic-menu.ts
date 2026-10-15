// The per-topic menu R1 draws for a topic tab (right-click, or a long press): the preview's rows in the preview's order
// (Rename…, Change icon…, Pin, Mute, Close, a divider, Delete…). Main chat and the All tab never get this menu.
import type { MenuItem } from "./Menu";
import { menuIcon } from "./menu-icons";

export type R1TopicMenuState = { title: string; pinned: boolean; muted: boolean; closed: boolean };
export type R1TopicMenuActions = { rename: () => void; changeIcon: () => void; pin: () => void; mute: () => void; close: () => void; remove: () => void };

export function r1TopicMenuItems(state: R1TopicMenuState, act: R1TopicMenuActions): MenuItem[] {
  return [
    { kind: "head", label: state.title },
    { label: "Rename…", icon: menuIcon("edit"), run: act.rename },
    { label: "Change icon…", icon: menuIcon("star"), run: act.changeIcon },
    { label: state.pinned ? "Unpin" : "Pin", icon: menuIcon("pin"), run: act.pin },
    { label: state.muted ? "Unmute" : "Mute", icon: menuIcon("bell"), run: act.mute },
    { label: state.closed ? "Reopen" : "Close", icon: menuIcon("check"), run: act.close },
    { kind: "sep" },
    { label: "Delete…", icon: menuIcon("trash"), danger: true, run: act.remove },
  ];
}
