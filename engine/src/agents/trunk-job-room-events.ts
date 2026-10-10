// One room event per Trunk job transition (claimed, done, released), written into each live group room the
// Trunk is an enabled member of. It only appends to the room log. It never starts a Trunk turn, so a job
// transition cannot wake a model run. The group view reads these events as the queue's feed.
import { appendRoomEvent, listRooms, type Room } from "../gateway/rooms/store.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/trunk-queue");

export type TrunkJobTransition =
  | { kind: "claimed"; trunkId: string; jobId: string; title: string }
  | { kind: "done"; trunkId: string; jobId: string; title: string; note?: string }
  | { kind: "released"; trunkId: string; jobId: string; title: string; reason: string };

/** The PR number a done note names: "PR #123" or a ".../pull/123" link. */
export function prNumberFromNote(note: string | undefined): number | undefined {
  const match = /(?:\bPR\s*#|\/pull\/)(\d+)/i.exec(note ?? "");
  return match ? Number(match[1]) : undefined;
}

export function jobTransitionText(event: TrunkJobTransition): string {
  switch (event.kind) {
    case "claimed":
      return `${event.trunkId} picked up: ${event.title}`;
    case "done": {
      const pr = prNumberFromNote(event.note);
      return `${event.trunkId} finished: ${event.title}${pr === undefined ? "" : `, PR #${pr}`}`;
    }
    case "released":
      return `${event.trunkId} gave back ${event.title} (${event.reason})`;
  }
}

function isEnabledTrunk(room: Room, trunkId: string): boolean {
  return room.members.some(
    (member) => member.kind === "trunk" && member.id === trunkId && member.enabled,
  );
}

/**
 * Writes the transition as one "job" room event in each live room the Trunk is an enabled member of.
 * A failed write is logged and never thrown, so a room problem cannot fail or undo a claim, done,
 * or release.
 */
export function recordTrunkJobTransition(event: TrunkJobTransition): void {
  try {
    const payload = {
      text: jobTransitionText(event),
      transition: event.kind,
      jobId: event.jobId,
      title: event.title,
    };
    for (const room of listRooms(false)) {
      if (isEnabledTrunk(room, event.trunkId)) {
        try {
          appendRoomEvent(room.roomId, "job", event.trunkId, payload);
        } catch (error) {
          log.warn(`trunk job room event not recorded for room ${room.roomId}: ${String(error)}`);
        }
      }
    }
  } catch (error) {
    log.warn(`trunk job room event not recorded: ${String(error)}`);
  }
}
