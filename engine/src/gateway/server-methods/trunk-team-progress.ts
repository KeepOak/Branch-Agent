import { setQueueTransitionListener } from "../../agents/trunk-queue.js";
// Posts one plain line to a team's group room when a team job is picked up, finished, handed back, or stuck.
// The queue reports real transitions only, so an idle queue posts nothing.
import { teamProgressPost } from "../../agents/trunk-team-progress.js";
import { appendRoomEvent, getRoom } from "../rooms/store.js";
import type { GatewayBroadcastFn } from "../server-broadcast-types.js";

let broadcaster: GatewayBroadcastFn | undefined;

/** Tells the open team cards that a proposal changed state. Silent until the gateway has attached its broadcast. */
export function publishTeamChange(payload: Record<string, unknown>): void {
  broadcaster?.("trunks.team.changed", payload, { dropIfSlow: true });
}

/** Attaches the gateway's one progress sink. Called once when the gateway starts its subscriptions. */
export function attachTeamProgress(broadcast: GatewayBroadcastFn): void {
  broadcaster = broadcast;
  setQueueTransitionListener((transition) => {
    const post = teamProgressPost(transition, (roomId) => Boolean(getRoom(roomId)));
    if (!post) {
      return;
    }
    const posted = appendRoomEvent(post.roomId, "message", post.actorId, { text: post.text });
    broadcast("rooms.event", posted, { dropIfSlow: true });
  });
}
