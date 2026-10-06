// Room rules (DESIGN-SPEC §4.2.4 "Room rules", the preview's rr17c popover), drawn as a glass menu:
// "Who answers": "A lead Trunk decides", "Everyone, every time", "Only those you @mention"; then "How the Trunks work
// together here". In a chat-app group, Everyone and @mention set the engine's groupActivation ("always" / "mention");
// the rest has no engine method yet and is greyed with the reason.
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
export const ruleToast = (rule: Rule, room: string) => `${rule === "always" ? "Everyone, every time" : "Only those you @mention"}, in ${room} from now on.`;

export function roomRulesItems(p: { chatApp: boolean; rule: Rule | null; choose: (rule: Rule) => void }): MenuItem[] {
  const who = WHO.map(([v, label, sub]): MenuItem => {
    const reason = v === "lead" ? ROOM_REASONS.lead : p.chatApp ? undefined : ROOM_REASONS.whoAnswers;
    return { label, sub, checked: p.rule === v, run: () => v !== "lead" && p.choose(v), ...(reason ? { disabled: reason } : {}) };
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
