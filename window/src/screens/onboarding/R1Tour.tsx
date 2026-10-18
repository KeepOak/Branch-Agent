// The R1 walkthrough (QUEUE-PASS17 item 37, ONBOARDING-PROPOSAL "Walkthrough: 3 cards, not 30"). After setup lands in the
// first conversation, three skippable clear-glass cards (README item 48) show, and the set ends in the message box. Guide ›
// Take the full tour runs the Classic tour (shell/Walkthrough.tsx, re-hosted) with only the cards that can show in this
// window, so its counter never jumps.
import { useMemo } from "react";
import { tourCards, Walkthrough, type Card } from "../../shell/Walkthrough";

export type R1TourKind = "intro" | "full";

/**
 * The three cards: Your Trunks; Customize & Seedbank; Settings, Guide & help.
 * Sidebar spotlights stay off: a hole there dims the rest of the list. Each card points at a part of the
 * conversation the new user can see right after setup, or sits centred when that part is only in the sidebar.
 * Your Trunks marks the Trunk’s name in the header. Customize and Seedbank, and Settings, search and the Guide,
 * are not on the conversation, so those cards have no spotlight.
 */
export const INTRO_CARDS: Card[] = [
  { title: "Your Trunks", target: ".r1-header .g-pill", text: "Chat with each Trunk like a teammate. Topics keep a job’s threads apart, and the line under a reply shows the agents’ work." },
  { title: "Customize & Seedbank", target: null, text: "Customize is what your Trunks can do: their tools, skills and connections. Seedbank is where you get more." },
  { title: "Settings, Guide & help", target: null, text: "Everything has a home in Settings, and search finds anything. The Guide, in the menu on your name, takes you on the full tour any time." },
];

/** A card can show when it needs no part of the window, opens its own part first, or its part is in the window now. */
export function canShow(card: Card, root: ParentNode = document): boolean {
  return card.target === null || card.prep !== undefined || root.querySelector(card.target) !== null;
}

/** The open conversation's message box, where the 3-card walkthrough ends. */
const toComposer = () => document.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')?.focus();

export function R1Tour({ kind, defaultName, onClose }: { kind: R1TourKind; defaultName: string; onClose: () => void }) {
  const cards = useMemo(() => (kind === "intro" ? INTRO_CARDS : tourCards(defaultName).filter((card) => canShow(card))), [kind, defaultName]);
  const close = () => { onClose(); if (kind === "intro") requestAnimationFrame(toComposer); };
  return <Walkthrough clear defaultName={defaultName} cards={cards} onClose={close} />;
}
