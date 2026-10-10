// Opens Automations › Board from elsewhere (Overview's running count, a card's link, the removed Canopy place). The request
// waits here until the Board mounts, so a Board that is not open yet still lands on the right view, with a named card's sheet open.
export const BOARD_REQUEST_EVENT = "branch:board-request";

/** Today: active cards and anything that moved since midnight. Running: cards a Trunk is on now. All: every card. */
export type BoardScope = "today" | "running" | "all";
export type BoardRequest = { card?: string; scope?: BoardScope };

let pending: BoardRequest | null = null;

/** Opens the Board on a scope, and the named card's sheet when a card id is given. */
export function openBoard(card = "", scope?: BoardScope): void {
  pending = { card, scope };
  window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "automations", tab: "Board" } }));
  window.dispatchEvent(new CustomEvent(BOARD_REQUEST_EVENT, { detail: { card, scope } }));
}

/** Whether a Board request is waiting, so Automations starts on the Board tab. */
export const boardRequested = (): boolean => pending !== null;

/** The waiting request, read without clearing it. */
export const peekBoardRequest = (): BoardRequest | null => pending;

/** Clears the waiting request once the Board has shown it. */
export function takeBoardRequest(): void {
  pending = null;
}
