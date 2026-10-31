// The R1 walkthrough (QUEUE-PASS17 item 37, ONBOARDING-PROPOSAL "Walkthrough: 3 cards, not 30"). After setup lands in the
// first conversation, three skippable clear-glass cards (README item 48) show, and the set ends in the message box. Guide ›
// Take the full tour runs the Classic tour (shell/Walkthrough.tsx, re-hosted) with only the cards that can show in this
// window, so its counter never jumps.
import { useMemo } from "react";
import { tourCards, Walkthrough, type Card } from "../../shell/Walkthrough";

export type R1TourKind = "intro" | "full";

/**
 * The three cards: Your Trunks; Customize & Seedbank; Settings, Guide & help.
 * Each card shows where the thing it describes lives. Your Trunks marks the Trunk’s name in the header.
 * Customize & Seedbank marks the Seedbank button in the sidebar, and Settings, Guide & help marks the menu on
 * your name. Those two opt in to a sidebar spotlight; every other card keeps the hole out of the sidebar.
 */
export const INTRO_CARDS: Card[] = [
  { title: "Your Trunks", target: ".r1-header .g-pill", text: "Chat with each Trunk like a teammate. Topics keep a job’s threads apart, and the line under a reply shows the agents’ work." },
  { title: "Customize & Seedbank", target: ".r1sb-seed", sidebarSpot: true, text: "Customize is what your Trunks can do: their tools, skills and connections. Seedbank is where you get more." },
  { title: "Settings, Guide & help", target: ".r1sb-me", sidebarSpot: true, text: "Everything has a home in Settings, and search finds anything. The Guide, in the menu on your name, takes you on the full tour any time." },
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
