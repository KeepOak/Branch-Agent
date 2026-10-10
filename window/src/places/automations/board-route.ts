// Opens Automations › Board from elsewhere (Canopy's Now tab, a card's "On the board" link). The request waits here until
// the Board mounts, so a Board that is not open yet still lands on the right tab, with the named card's sheet open.
export const BOARD_CARD_EVENT = "branch:board-card";

let pending: { card: string } | null = null;

/** Opens the Board, and the named card's sheet when a card id is given. */
export function openBoard(cardId = ""): void {
  pending = { card: cardId };
  window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "automations", tab: "Board" } }));
  if (cardId) window.dispatchEvent(new CustomEvent(BOARD_CARD_EVENT, { detail: { id: cardId } }));
}

/** Whether a Board request is waiting, so Automations starts on the Board tab. */
export const boardRequested = (): boolean => pending !== null;

/** The card a waiting request names, read without clearing it. */
export const peekBoardCard = (): { id: string } | null => (pending?.card ? { id: pending.card } : null);

/** Clears the waiting request once the Board has shown it. */
export function takeBoardRequest(): void {
  pending = null;
}
