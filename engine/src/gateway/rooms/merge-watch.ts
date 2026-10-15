import { openBranchStateDatabase } from "../../state/branch-state-db.js";
import { recordRoomMerge } from "./merge-feed.js";
import { appendRoomEvent, getRoom, type RoomEvent } from "./store.js";

/*
 * Keeps the merge feed live. A room follows a repository once (rooms.merge.follow); from then on
 * the gateway checks that repository's recently closed pull requests on a timer and records every
 * merge into the followed base branch through recordRoomMerge, so each merge gets its one sentence
 * whoever merged it (the auto-merger, a Trunk or a person). Merges from before the follow are
 * left out, and the event id guard in recordRoomMerge keeps a re-seen merge from posting twice.
 */

export const MERGE_FOLLOW_EVENT_KIND = "merge.follow";
const MERGE_FOLLOW_ACTOR_ID = "merge-feed";

export type MergeFollow = { roomId: string; repo: string; base: string; since: number };
export type MergedPullRequest = { number: number; title: string; base: string; mergedAt: number };
/** Returns the repository's most recently updated closed pull requests that were merged. */
export type FetchMergedPullRequests = (repo: string) => Promise<MergedPullRequest[]>;

const followEventId = (repo: string, base: string) => `merge.follow:${repo.toLowerCase()}@${base}`;

function parseFollow(roomId: string, json: string): MergeFollow | undefined {
  try {
    const value = JSON.parse(json) as Partial<MergeFollow>;
    if (
      typeof value.repo === "string" &&
      typeof value.base === "string" &&
      typeof value.since === "number"
    ) {
      return { roomId, repo: value.repo, base: value.base, since: value.since };
    }
  } catch {
    // A malformed row is skipped; the store only writes JSON it produced itself.
  }
  return undefined;
}

/**
 * Makes the room follow merges into `base` of `repo`. Following again is a no-op that returns
 * the original follow, so its start time (and with it the first merge it announces) never moves.
 */
export function followRoomMerges(
  roomId: string,
  repo: string,
  base = "main",
  now = Date.now(),
): { follow: MergeFollow; event?: RoomEvent } {
  const room = getRoom(roomId);
  if (!room || room.archivedAt !== undefined) {
    throw new Error("Room not found");
  }
  const eventId = followEventId(repo, base);
  const db = openBranchStateDatabase().db;
  const existing = db
    .prepare("SELECT payload_json FROM room_events WHERE room_id=? AND event_id=?")
    .get(roomId, eventId) as { payload_json: string } | undefined;
  const saved = existing ? parseFollow(roomId, existing.payload_json) : undefined;
  if (saved) {
    return { follow: saved };
  }
  const follow: MergeFollow = { roomId, repo, base, since: now };
  const event = appendRoomEvent(
    roomId,
    MERGE_FOLLOW_EVENT_KIND,
    MERGE_FOLLOW_ACTOR_ID,
    { repo, base, since: now, text: `Following merges to ${repo} ${base}` },
    eventId,
  );
  return { follow, event };
}

/** Every follow in a room that is not archived. */
export function listMergeFollows(): MergeFollow[] {
  const rows = openBranchStateDatabase()
    .db.prepare(
      "SELECT e.room_id AS roomId, e.payload_json AS json FROM room_events e JOIN rooms r ON r.room_id=e.room_id WHERE e.kind=? AND r.archived_at IS NULL ORDER BY e.room_id, e.seq",
    )
    .all(MERGE_FOLLOW_EVENT_KIND) as { roomId: string; json: string }[];
  return rows.flatMap((row) => parseFollow(row.roomId, row.json) ?? []);
}

/**
 * One pass of the watcher: fetches each followed repository once and records its new merges in
 * every room that follows it, oldest merge first so the running count follows merge order.
 * Returns the events it recorded; each one is also handed to `broadcast`.
 */
export async function pollRoomMergeFollows(params: {
  fetchMerged: FetchMergedPullRequests;
  broadcast: (event: RoomEvent) => void;
  warn?: (message: string) => void;
}): Promise<RoomEvent[]> {
  const follows = listMergeFollows();
  const byRepo = new Map<string, MergeFollow[]>();
  for (const follow of follows) {
    const key = follow.repo.toLowerCase();
    byRepo.set(key, [...(byRepo.get(key) ?? []), follow]);
  }
  const recorded: RoomEvent[] = [];
  for (const repoFollows of byRepo.values()) {
    const repo = repoFollows[0]!.repo;
    let merged: MergedPullRequest[];
    try {
      merged = await params.fetchMerged(repo);
    } catch (error) {
      params.warn?.(
        `Merge feed could not read merges for ${repo}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const ordered = merged.toSorted((a, b) => a.mergedAt - b.mergedAt || a.number - b.number);
    for (const follow of repoFollows) {
      for (const pr of ordered) {
        if (pr.base !== follow.base || pr.mergedAt < follow.since) {
          continue;
        }
        try {
          const event = recordRoomMerge(follow.roomId, {
            repo: follow.repo,
            number: pr.number,
            title: pr.title,
          });
          if (event) {
            recorded.push(event);
            params.broadcast(event);
          }
        } catch (error) {
          params.warn?.(
            `Merge feed could not record #${pr.number}: ${error instanceof Error ? error.message : String(error)}`,
          );
          break;
        }
      }
    }
  }
  return recorded;
}

/** Reads one GitHub pulls-list item as a merged pull request, or undefined when it was not merged. */
export function parseMergedPullRequest(value: unknown): MergedPullRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const item = value as {
    number?: unknown;
    title?: unknown;
    merged_at?: unknown;
    base?: { ref?: unknown };
  };
  const mergedAt = typeof item.merged_at === "string" ? Date.parse(item.merged_at) : Number.NaN;
  if (
    typeof item.number !== "number" ||
    !Number.isSafeInteger(item.number) ||
    item.number < 1 ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    typeof item.base?.ref !== "string" ||
    !Number.isFinite(mergedAt)
  ) {
    return undefined;
  }
  return { number: item.number, title: item.title, base: item.base.ref, mergedAt };
}
