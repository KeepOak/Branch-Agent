import { openBranchStateDatabase } from "../../state/branch-state-db.js";
import { appendRoomEvent, type RoomEvent } from "./store.js";

/*
 * Plain-language merge feed: each merge to main becomes one sentence in a room, with a running
 * count, for example "That's 107 merged: #1088 fix(ci): list the workflows." The count is the
 * number of merges this room has announced, so it starts at 1 in a new room and never skips.
 */

export const MERGE_EVENT_KIND = "merge";
const MERGE_ACTOR_ID = "merge-feed";

export type MergeNotice = {
  /** owner/name, for example KeepOak/Branch-Agent. */
  repo: string;
  number: number;
  title: string;
};

export type MergeEventPayload = MergeNotice & { text: string; count: number };

/** One sentence: the count, the PR number and its title, ending in a single full stop. */
export function formatMergeSentence(count: number, merge: Pick<MergeNotice, "number" | "title">) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Invalid merge count");
  }
  if (!Number.isSafeInteger(merge.number) || merge.number < 1) {
    throw new Error("Invalid pull request number");
  }
  const title = merge.title
    .replace(/\s+/g, " ")
    .trim()
    // A sentence break inside the title would make two sentences; join the parts instead.
    .replace(/[.!?\u2026]+\s+(?=\S)/gu, "; ")
    .replace(/[\s.!?\u2026;:,]+$/u, "");
  return `That's ${count} merged: #${merge.number}${title ? ` ${title}` : ""}.`;
}

/**
 * Records one merge in the room. Returns the new event, or undefined when this room already
 * announced the same pull request, so a retried or doubled merge event never posts twice.
 */
export function recordRoomMerge(roomId: string, merge: MergeNotice): RoomEvent | undefined {
  const eventId = `merge:${merge.repo}#${merge.number}`;
  const db = openBranchStateDatabase().db;
  if (db.prepare("SELECT 1 FROM room_events WHERE room_id=? AND event_id=?").get(roomId, eventId)) {
    return undefined;
  }
  // The count read and the append run in the same synchronous turn, so no other merge can land
  // between them; the room's UNIQUE (room_id, event_id) still refuses a duplicate.
  const { count } = db
    .prepare("SELECT count(*) AS count FROM room_events WHERE room_id=? AND kind=?")
    .get(roomId, MERGE_EVENT_KIND) as { count: number };
  const next = count + 1;
  const payload: MergeEventPayload = {
    repo: merge.repo,
    number: merge.number,
    title: merge.title,
    count: next,
    text: formatMergeSentence(next, merge),
  };
  return appendRoomEvent(roomId, MERGE_EVENT_KIND, MERGE_ACTOR_ID, payload, eventId);
}
