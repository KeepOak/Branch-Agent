// The walkthrough (DESIGN-SPEC §4.8.2): a spotlight on one part of the window at a time with a short card. A card
// whose part isn't on screen shows centred without a spotlight, so the count stays the same (owner Q93). Toasts and
// banners are held while it runs and show when it ends (rule 2). No mascot on the card (rule 5).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./walkthrough.css";

type Card = { title: string; text: string; target: string | null };

/** The cards, in the spec's order; the prototype-only surface switcher card is left out (§8). */
export function tourCards(defaultName: string): Card[] {
  return [
    { title: "Your Trunks are contacts", target: "[data-testid=conversation-list]", text: "Each Trunk is an assistant with one job. Message it like a teammate. A moving ring means it’s working; a dot means it needs you." },
    { title: "Your Trunks, in person", target: ".character-panel", text: "Each Trunk can have a character. It acts out what the Trunk is really doing: thinking, searching, reading, working, waiting for you, celebrating, resting. Change it in the Trunk’s Look tab." },
    { title: "Watch it work", target: ".computer-activity-card", text: "When a Trunk uses the browser you see it live, with Take over one click away. Its plan and folded steps sit just above." },
    { title: "Its own computer, full size", target: ".computer-stage", text: "Pick which computer a Trunk may use: a private sandbox, this PC, the KeepOak computer or a home server. Watch it live, take over, or shrink it to a small window." },
    { title: "It asks before it acts", target: "[data-testid=approval-card]", text: "Anything that sends, deletes, spends or installs waits for your yes: Send it, Always allow, or Don’t. The Inbox collects them all." },
    { title: "Rooms: Trunks together", target: null, text: "Several Trunks in one conversation. Call one with @, choose who answers, and answer two asks with Yes to both." },
    { title: "Model and thinking", target: "[data-testid=model-chip]", text: "GPT-6.1 Sol, Opus 5.5 or the model on this computer, and how long it thinks. The choices change with the model." },
    { title: "How much it may do", target: "[data-testid=mode-chip]", text: "Auto, Ask first, Plan first, Read only or Full access, per conversation. Shift+Tab switches; Lockdown stops everything." },
    { title: "Everything else is in +", target: "[data-testid=plus]", text: "Attach files, @mention a Trunk, use a skill, go Temporary, have it ask questions first, or choose who answers." },
    { title: "The side panel", target: ".conversation-pane", text: "Activity, Plan, Files and Memory beside the conversation. Drag its edge to any width; double-click to reset. The browser and computer open full size instead." },
    { title: "What each account has left", target: "[data-testid=sb-usage]", text: "The ring shows the account used next. Click it for every plan’s 5-hour, daily and weekly limits." },
    { title: "The gateway", target: "[data-testid=sb-gateway]", text: "Keeps your Trunks running when Branch is closed, and starts Branch again if it ever stops." },
    { title: "Seven places", target: "nav.places", text: "Overview at a glance, Canopy to watch and steer all the work at once, Inbox for what needs you, Automations for work on its own, Library for what it remembers and made, People for who uses Branch, Customize for Trunks, skills and chat apps." },
    { title: "Search everything", target: "[data-testid=search]", text: "Chats, Trunk names, words inside messages and past sessions, as you type. Ctrl F finds words in a conversation; Ctrl K opens every command." },
    { title: "Settings, your way", target: "[data-testid=gear]", text: "Regular, Advanced or Technical: just the essentials, or every file, port and raw key." },
    { title: "Models on this computer", target: null, text: "Branch looks at your memory and graphics card and only offers what fits. One click installs it; it runs free and private." },
    { title: "Every chat app", target: null, text: "Each with its real recipe: make the bot, paste what it gives you, Branch checks it, you approve an 8-character code, save." },
    { title: "Pets and painted scenes", target: null, text: "Pick one of dozens of pets to walk along the list, and a painted scene to sit behind the glass. They nap, cheer and follow what your Trunks are doing." },
    { title: "Your team", target: null, text: "Who’s here and what their Trunks are running right now, shared Trunks, teams of Trunks, usage and rules. It comes from your keepoak.com workspace." },
    { title: "People", target: null, text: "On this computer with a PIN, on their own devices with a passkey or a one-time code, or from your keepoak.com team. Seven kinds of action each; groups only take away." },
    { title: "Group chats, and Trunks that talk", target: null, text: "People, Trunks and agents on other computers in one conversation. Trunks can ask each other and sort it out; you see it folded up, and you choose who answers." },
    { title: "Branch changes itself, safely", target: null, text: "Ask it to change its own settings or gateway. It tries the change on a throwaway copy, shows you before and after, and every change can be rolled back." },
    { title: "Your layout", target: "[data-testid=list-toggle]", text: "Ctrl B hides the list. Drag any edge: narrow the list to icons, widen the side panel, or give the computer more room. Double-click an edge to reset." },
    { title: "Branch in a terminal", target: null, text: "Type branch anywhere. The same places as a tab row, y/a/n to answer, /usage, /theme and every other command." },
    { title: "On your phone", target: null, text: `Pair with a square code. Answer ${defaultName} from the lock screen, send files from the share sheet, talk with one button.` },
    { title: "keepoak.com, as it is", target: null, text: "The real portal: your computer, agents, approvals and plan. Branch has its own place next to Agents, with every computer it runs on and every Trunk you can talk to." },
    { title: "Sound and video in the chat", target: null, text: "Recordings play where they were sent. Hover any message to pin it, so it stays in front of the assistant however long the conversation runs." },
    { title: "A board for longer work", target: null, text: "Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself." },
    { title: "Memory that stays tidy", target: null, text: "The ring shows how much memory loads at the start, and whether it was trimmed. Tidy up finds facts said twice, facts that disagree, and ones nobody uses." },
    { title: "That’s the walkthrough", target: null, text: "Replay it any time from the Guide menu › Take the walkthrough." },
  ];
}

type Box = { top: number; left: number; width: number; height: number } | null;

/** The target's box, if it is on screen. */
function boxOf(selector: string | null): Box {
  const el = selector ? document.querySelector<HTMLElement>(selector) : null;
  const r = el?.getBoundingClientRect();
  if (!r || r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) {
    return null;
  }
  return { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 };
}

/** Below the target, else above, else beside; kept inside the window. Centred with no target. */
function cardAt(box: Box, w: number, h: number): { top: number; left: number } {
  if (!box) {
    return { top: (innerHeight - h) / 2, left: (innerWidth - w) / 2 };
  }
  const clampX = (x: number) => Math.max(12, Math.min(x, innerWidth - w - 12));
  const clampY = (y: number) => Math.max(12, Math.min(y, innerHeight - h - 12));
  if (box.top + box.height + 12 + h < innerHeight) {
    return { top: box.top + box.height + 12, left: clampX(box.left) };
  }
  if (box.top - 12 - h > 0) {
    return { top: box.top - 12 - h, left: clampX(box.left) };
  }
  const right = box.left + box.width + 12;
  return { top: clampY(box.top), left: right + w < innerWidth ? right : clampX(box.left - 12 - w) };
}

export function Walkthrough({ defaultName, onClose }: { defaultName: string; onClose: () => void }) {
  const cards = useMemo(() => tourCards(defaultName), [defaultName]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const card = useRef<HTMLDivElement>(null);
  const last = i === cards.length - 1;
  const place = useCallback(() => {
    const b = boxOf(cards[i].target);
    setBox(b);
    const r = card.current?.getBoundingClientRect();
    setPos(cardAt(b, r?.width ?? 340, r?.height ?? 200));
  }, [cards, i]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    document.documentElement.classList.add("touring");
    addEventListener("resize", place);
    return () => {
      document.documentElement.classList.remove("touring");
      removeEventListener("resize", place);
    };
  }, [place]);
  useEffect(() => (card.current?.querySelector<HTMLButtonElement>("[data-next]") ?? card.current?.querySelector<HTMLButtonElement>("button"))?.focus(), [i]);
  const go = (step: number) => setI((n) => Math.max(0, Math.min(cards.length - 1, n + step)));
  return (
    <div
      className="tour-layer"
      data-testid="walkthrough"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && !last) go(1);
        else if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={box ? "tour-spot" : "tour-spot none"} style={box ?? undefined} />
      <div ref={card} className="tour-card" role="dialog" aria-live="polite" aria-label="Tour" style={pos}>
        <span className="n">
          {i + 1} of {cards.length}
        </span>
        <b>{cards[i].title}</b>
        <p>{cards[i].text}</p>
        <div className="tour-dots" aria-hidden="true">
          {cards.map((c, j) => (
            <i key={c.title} className={j === i ? "on" : ""} />
          ))}
        </div>
        <div className="acts">
          {i > 0 ? (
            <button type="button" className="btn ghost sm" onClick={() => go(-1)}>
              Back
            </button>
          ) : null}
          <span className="grow" />
          <button type="button" className="btn ghost sm" data-testid="tour-end" onClick={onClose}>
            {last ? "Close" : "Skip the tour"}
          </button>
          {last ? null : (
            <button type="button" className="btn pri sm" data-next data-testid="tour-next" onClick={() => go(1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
