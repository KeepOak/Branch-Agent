// Room rules (DESIGN-SPEC §4.2.4 "Room rules", the preview's rr17c popover), drawn as a glass menu:
// "Who answers": "A lead Trunk decides", "Everyone, every time", "Only those you @mention". In a Branch group, lead
// calls rooms.rule.set; Everyone and @mention stay greyed until rooms.send starts every enabled member or the
// mentioned members instead of always the lead. In a chat-app group, Everyone and @mention set the engine's
// groupActivation ("always" / "mention"); lead stays greyed. The working-together section was removed: it had no
// engine method and every row was greyed. A participant room that is
// neither a Branch group nor a chat-app group keeps Who answers greyed: lead has no method there, and Everyone /
// @mention only write groupActivation on chat-app sessions.
import type { MenuItem } from "../shell/Menu";
import { ROOM_REASONS } from "./room-menu";
import type { Rule } from "./useRoom";

const WHO: [Rule | "lead", string, string][] = [
  ["lead", "A lead Trunk decides", "It reads each message and picks who answers."],
  ["always", "Everyone, every time", "Every Trunk in the group answers."],
  ["mention", "Only those you @mention", "Nobody mentioned means everyone."],
];

/** The words the toast uses after a change: "<rule>, in <room> from now on." */
export const ruleToast = (rule: Rule | "lead", room: string) => {
  const text = rule === "lead" ? "A lead Trunk decides" : rule === "always" ? "Everyone, every time" : "Only those you @mention";
  return `${text}, in ${room} from now on.`;
};

export function roomRulesItems(p: { chatApp: boolean; branchGroup?: boolean; rule: Rule | "lead" | null; choose: (rule: Rule | "lead") => void }): MenuItem[] {
  const who = WHO.map(([v, label, sub]): MenuItem => {
    const reason = p.branchGroup
      ? (v === "lead" ? undefined : v === "always" ? ROOM_REASONS.everyone : ROOM_REASONS.mentions)
      : v === "lead" ? ROOM_REASONS.lead : p.chatApp ? undefined : ROOM_REASONS.whoAnswers;
    return { label, sub, checked: p.rule === v, run: () => { if (!reason) p.choose(v); }, ...(reason ? { disabled: reason } : {}) };
  });
  return [
    { kind: "custom", node: <div className="pt">Group rules</div> },
    { kind: "head", label: "Who answers" },
    ...who,
  ];
}
