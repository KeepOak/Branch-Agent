// The walkthrough (DESIGN-SPEC §4.8.2): a spotlight on one part of the window at a time with a short card. As in the
// preview, a card first opens what it shows (the side panel, a Settings page, a place and its tab) and, at phone width,
// slides the list in for the list's own parts. A card whose part isn't on screen shows centred without a spotlight, so
// the count stays the same (owner Q93). Toasts and banners are held while it runs and show when it ends (rule 2). No
// mascot on the card (rule 5).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./walkthrough.css";

type Card = { title: string; text: string; target: string | null; prep?: () => void; side?: boolean };

/** Shows the side panel (or hides it) through its top-bar button. */
function sidePanel(open: boolean) {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Side panel"]');
  if (button && (button.getAttribute("aria-pressed") === "true") !== open) button.click();
}
const settings = (page: string) => () => window.dispatchEvent(new CustomEvent("branch:navigate-settings", { detail: { page } }));
const place = (id: string, tab?: string) => () => window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: id, ...(tab ? { tab } : {}) } }));
const NARROW = 760;

/** The cards, in the spec's order; the prototype-only surface switcher card is left out (§8). */
export function tourCards(defaultName: string): Card[] {
  return [
    { title: "Your Trunks are contacts", target: "[data-testid=conversation-list]", side: true, prep: () => sidePanel(false), text: "Each Trunk is an assistant with one job. Message it like a teammate. A moving ring means it’s working; a dot means it needs you." },
    { title: "Your Trunks, in person", target: ".character-panel", text: "Each Trunk can have a character. It acts out what the Trunk is really doing: thinking, searching, reading, working, waiting for you, celebrating, resting. Change it in the Trunk’s Look tab." },
    { title: "Watch it work", target: ".computer-activity-card", text: "When a Trunk uses the browser you see it live, with Take over one click away. Its plan and folded steps sit just above." },
    { title: "Its own computer, full size", target: ".computer-stage", text: "Pick which computer a Trunk may use: a private sandbox, this PC, the KeepOak computer or a home server. Watch it live, take over, or shrink it to a small window." },
    { title: "It asks before it acts", target: "[data-testid=approval-card]", text: "Anything that sends, deletes, spends or installs waits for your yes: Send it, Always allow, or Don’t. The Inbox collects them all." },
    { title: "Rooms: Trunks together", target: null, text: "Several Trunks in one conversation. Call one with @, choose who answers, and answer two asks with Yes to both." },
    { title: "Model and thinking", target: "[data-testid=model-chip]", text: "GPT-6.1 Sol, Opus 5.5 or the model on this computer, and how long it thinks. The choices change with the model." },
    { title: "How much it may do", target: "[data-testid=mode-chip]", text: "Auto, Ask first, Plan first, Read only or Full access, per conversation. Shift+Tab switches; Lockdown stops everything." },
    { title: "Everything else is in +", target: "[data-testid=plus]", text: "Attach files, @mention a Trunk, use a skill, go Temporary, have it ask questions first, or choose who answers." },
    { title: "The side panel", target: ".conversation-pane", prep: () => sidePanel(true), text: "Activity, Plan, Files and Memory beside the conversation. Drag its edge to any width; double-click to reset. The browser and computer open full size instead." },
    { title: "What each account has left", target: "[data-testid=sb-usage]", prep: () => sidePanel(false), text: "The ring shows the account used next. Click it for every plan’s 5-hour, daily and weekly limits." },
    { title: "The gateway", target: "[data-testid=sb-gateway]", text: "Keeps your Trunks running when Branch is closed, and starts Branch again if it ever stops." },
    { title: "Seven places", target: "nav.places", side: true, text: "Overview at a glance, Canopy to watch and steer all the work at once, Inbox for what needs you, Automations for work on its own, Library for what it remembers and made, People for who uses Branch, Customize for Trunks, skills and chat apps." },
    { title: "Search everything", target: "[data-testid=search]", side: true, text: "Chats, Trunk names, words inside messages and past sessions, as you type. Ctrl F finds words in a conversation; Ctrl K opens every command." },
    { title: "Settings, your way", target: "[data-testid=gear]", side: true, text: "Regular, Advanced or Technical: just the essentials, or every file, port and raw key." },
    { title: "Models on this computer", target: ".lm-grid-k", prep: settings("local"), text: "Branch looks at your memory and graphics card and only offers what fits. One click installs it; it runs free and private." },
    { title: "Every chat app", target: ".cz-chgrid", prep: place("customize", "Channels"), text: "Each with its real recipe: make the bot, paste what it gives you, Branch checks it, you approve an 8-character code, save." },
    { title: "Pets and painted scenes", target: ".pets12", prep: settings("appearance"), text: "Pick one of dozens of pets to walk along the list, and a painted scene to sit behind the glass. They nap, cheer and follow what your Trunks are doing." },
    { title: "Your team", target: '.side [data-place="people"]', side: true, text: "Who’s here and what their Trunks are running right now, shared Trunks, teams of Trunks, usage and rules. It comes from your keepoak.com workspace." },
    { title: "People", target: ".ppl", prep: place("people"), text: "On this computer with a PIN, on their own devices with a passkey or a one-time code, or from your keepoak.com team. Seven kinds of action each; groups only take away." },
    { title: "Group chats, and Trunks that talk", target: null, text: "People, Trunks and agents on other computers in one conversation. Trunks can ask each other and sort it out; you see it folded up, and you choose who answers." },
    { title: "Branch changes itself, safely", target: null, text: "Ask it to change its own settings or gateway. It tries the change on a throwaway copy, shows you before and after, and every change can be rolled back." },
    { title: "Your layout", target: "[data-testid=list-toggle]", text: "Ctrl B hides the list. Drag any edge: narrow the list to icons, widen the side panel, or give the computer more room. Double-click an edge to reset." },
    { title: "Branch in a terminal", target: null, text: "Type branch anywhere. The same places as a tab row, y/a/n to answer, /usage, /theme and every other command." },
    { title: "On your phone", target: null, text: `Pair with a square code. Answer ${defaultName} from the lock screen, send files from the share sheet, talk with one button.` },
    { title: "keepoak.com, as it is", target: null, text: "The real portal: your computer, agents, approvals and plan. Branch has its own place next to Agents, with every computer it runs on and every Trunk you can talk to." },
    { title: "Sound and video in the chat", target: null, text: "Recordings play where they were sent. Hover any message to pin it, so it stays in front of the assistant however long the conversation runs." },
    { title: "A board for longer work", target: ".au-board", prep: place("automations", "board"), text: "Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself." },
    { title: "Memory that stays tidy", target: "[data-testid=memory-card]", prep: place("library", "memory"), text: "The ring shows how much memory loads at the start, and whether it was trimmed. Tidy up finds facts said twice, facts that disagree, and ones nobody uses." },
    { title: "That’s Branch", target: null, text: "That’s the walkthrough. Take it again any time from the Guide." },
  ];
}

type Box = { top: number; left: number; width: number; height: number } | null;

/** The target's spotlight box (6 px around it, kept inside the window), if it is on screen. */
function boxOf(selector: string | null): Box {
  const el = selector ? document.querySelector<HTMLElement>(selector) : null;
  const first = el?.getBoundingClientRect();
  // a part further down its page (the pets in Appearance) is scrolled into view first
  if (el && first && first.height > 0 && (first.top > innerHeight || first.bottom < 0)) el.scrollIntoView({ block: "center" });
  const r = el?.getBoundingClientRect();
  if (!el || !r || !el.getClientRects().length || r.width < 2 || r.right < 2 || r.left > innerWidth - 2 || r.bottom < 0 || r.top > innerHeight) return null;
  const pad = 6, left = Math.max(4, r.left - pad), top = Math.max(4, r.top - pad);
  return { left, top, width: Math.min(innerWidth - left - 4, r.width + pad * 2), height: Math.min(innerHeight - top - 4, r.height + pad * 2) };
}

/** The preview's placement: below the spotlight, else above, else beside it; centred when there is none. */
function cardAt(box: Box, cw: number, ch: number): { top: number; left: number } {
  const W = innerWidth, H = innerHeight;
  if (!box) return { left: (W - cw) / 2, top: Math.max(60, (H - ch) / 2) };
  const { left: x, top: y, width: w, height: h } = box;
  let top = y + h + 12;
  if (top + ch > H - 8) top = y - ch - 12;
  if (top < 8) top = Math.max(8, Math.min(H - ch - 8, y + 12));
  let left = Math.min(Math.max(x, 12), W - cw - 12);
  if (top < y + h && top + ch > y && w < W - cw - 40) left = x + w + 12 + cw < W ? x + w + 12 : Math.max(12, x - cw - 12);
  return { top, left };
}

/** At phone width the list slides in for the list's own cards and out for the rest (the preview's SIDE_SEL). */
function slideList(open: boolean): boolean {
  const frame = document.querySelector(".frame");
  const toggle = document.querySelector<HTMLButtonElement>("[data-testid=list-toggle]");
  if (!frame || !toggle || frame.classList.contains("slide-open") === open) return false;
  toggle.click();
  return true;
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
    setPos(cardAt(b, card.current?.offsetWidth ?? 340, card.current?.offsetHeight ?? 200));
  }, [cards, i]);
  useLayoutEffect(() => {
    try {
      cards[i].prep?.();
    } catch {
      // the card still shows, centred, if its part can't open
    }
    const moved = innerWidth <= NARROW && slideList(Boolean(cards[i].side));
    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => requestAnimationFrame(place));
    }, moved ? 280 : 0);
    place();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [cards, i, place]);
  useEffect(() => {
    document.documentElement.classList.add("touring");
    addEventListener("resize", place);
    return () => {
      document.documentElement.classList.remove("touring");
      removeEventListener("resize", place);
    };
  }, [place]);
  useEffect(() => (card.current?.querySelector<HTMLButtonElement>("[data-next]") ?? card.current?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true }), [i]);
  useEffect(() => () => {
    if (innerWidth <= NARROW) slideList(false);
  }, []);
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
