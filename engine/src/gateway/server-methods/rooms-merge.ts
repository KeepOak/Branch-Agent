import {
  ErrorCodes,
  errorShape,
  validateRoomsMergeFollowParams,
  validateRoomsMergeRecordParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { recordRoomMerge } from "../rooms/merge-feed.js";
import { followRoomMerges } from "../rooms/merge-watch.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

/*
 * The merge feed's way in. Whatever merges to main (the merge Trunk, a CI step or a person) calls
 * rooms.merge.record once per merge, for example:
 *   branch gateway call rooms.merge.record --params '{"roomId":"…","repo":"KeepOak/Branch-Agent","number":1088,"title":"…"}'
 * The room gets one sentence with the running count; a repeat of the same PR is a no-op.
 *
 * rooms.merge.follow is the live path: once a room follows a repository, the gateway's merge
 * watcher (server-lifetime-sidecars.ts) calls recordRoomMerge for every later merge itself.
 */
export const roomMergeHandlers: GatewayRequestHandlers = {
  "rooms.merge.record": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsMergeRecordParams,
        "rooms.merge.record",
        options.respond,
      )
    ) {
      return;
    }
    try {
      const { roomId, repo, number, title } = options.params;
      const event = recordRoomMerge(roomId, { repo, number, title });
      if (!event) {
        options.respond(true, { recorded: false });
        return;
      }
      options.context.broadcast("rooms.event", event, { dropIfSlow: true });
      options.respond(true, { recorded: true, event });
    } catch (error) {
      options.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "rooms.merge.follow": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsMergeFollowParams,
        "rooms.merge.follow",
        options.respond,
      )
    ) {
      return;
    }
    try {
      const { roomId, repo, base } = options.params;
      const { follow, event } = followRoomMerges(roomId, repo, base ?? "main");
      if (event) {
        options.context.broadcast("rooms.event", event, { dropIfSlow: true });
      }
      options.respond(true, { following: true, created: Boolean(event), follow });
    } catch (error) {
      options.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
};
