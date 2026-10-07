// Room rules (DESIGN-SPEC §4.2.4 "Room rules", the preview's rr17c popover), drawn as a glass menu:
// "Who answers": "A lead Trunk decides", "Everyone, every time", "Only those you @mention"; then "How the Trunks work
// together here". In a Branch group, all three Who answers choices call rooms.rule.set. In a chat-app group,
// Everyone and @mention set the engine's groupActivation ("always" / "mention"); lead stays greyed. The
// working-together patterns have no engine method yet and stay greyed with the reason. A participant room that is
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
const PATTERNS: [string, string][] = [
  ["One at a time", "A Trunk calls a specialist, waits, carries on."],
  ["A lead and helpers", "One Trunk plans and hands out the parts."],
  ["Swarm", "Equals pass the work to whoever fits best."],
  ["Router", "Sends each request to the one Trunk that matches."],
  ["In parallel", "The same job split up, then gathered."],
  ["Teams", "Small groups, each with its own lead."],
];

/** The words the toast uses after a change: "<rule>, in <room> from now on." */
export const ruleToast = (rule: Rule | "lead", room: string) => {
  const text = rule === "lead" ? "A lead Trunk decides" : rule === "always" ? "Everyone, every time" : "Only those you @mention";
  return `${text}, in ${room} from now on.`;
};

export function roomRulesItems(p: { chatApp: boolean; branchGroup?: boolean; rule: Rule | "lead" | null; choose: (rule: Rule | "lead") => void }): MenuItem[] {
  const who = WHO.map(([v, label, sub]): MenuItem => {
    const reason = p.branchGroup ? undefined : v === "lead" ? ROOM_REASONS.lead : p.chatApp ? undefined : ROOM_REASONS.whoAnswers;
    return { label, sub, checked: p.rule === v, run: () => p.choose(v), ...(reason ? { disabled: reason } : {}) };
  });
  return [
    { kind: "custom", node: <div className="pt">Group rules</div> },
    { kind: "head", label: "Who answers" },
    ...who,
    { kind: "sep" },
    { kind: "head", label: "How the Trunks work together here" },
    { label: "Your default", sub: "Set in Settings › Models › Defaults", checked: false, run: () => undefined, disabled: ROOM_REASONS.pattern },
    ...PATTERNS.map(([label, sub]): MenuItem => ({ label, sub, checked: false, run: () => undefined, disabled: ROOM_REASONS.pattern })),
  ];
}
