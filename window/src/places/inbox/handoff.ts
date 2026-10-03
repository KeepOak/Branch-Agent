// What another place asks the Inbox to open with (the preview's presactPD18: "See their activity" opens
// History filtered to that person). Read once when the Inbox opens, then cleared.
export type InboxTab = "needs" | "finished" | "history" | "later";
export type InboxHandoff = { tab: InboxTab; people?: string[] };

let next: InboxHandoff | null = null;

export function openInboxWith(handoff: InboxHandoff): void {
  next = handoff;
}

export function takeInboxHandoff(): InboxHandoff | null {
  const value = next;
  next = null;
  return value;
}
