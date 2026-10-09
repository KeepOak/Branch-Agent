import {
  ErrorCodes,
  errorShape,
  validateRoomsLogParams,
  validateRoomsSendParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { getGatewayToolCallerIdentity } from "../../agents/tools/gateway-caller-context.js";
import { appendRoomEvent, getRoom, listRooms, readRoomLog, type Room } from "../rooms/store.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

/*
 * Group-chat tools for a Trunk acting in its own run. The caller is the run's host-owned tool caller
 * identity (the same trust sessions_send uses), never a field in request params, so a public client
 * cannot post as a Trunk.
 */

function respondFailure(respond: RespondFn, error: unknown) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}

function callingTrunkId(): string {
  const agentId = getGatewayToolCallerIdentity()?.agentId;
  if (!agentId) {
    throw new Error("Group chat tools are only available to a Trunk in its own run");
  }
  return agentId;
}

function isEnabledTrunkMember(room: Room, trunkId: string): boolean {
  return room.members.some((m) => m.kind === "trunk" && m.id === trunkId && m.enabled);
}

/** The live room this Trunk is an enabled member of; anything else is refused. */
function callingTrunkRoom(roomId: string): { room: Room; trunkId: string } {
  const trunkId = callingTrunkId();
  const room = getRoom(roomId);
  if (!room || room.archivedAt !== undefined) {
    throw new Error("Room not found");
  }
  if (!isEnabledTrunkMember(room, trunkId)) {
    throw new Error(`${trunkId} is not an enabled Trunk in this group chat`);
  }
  return { room, trunkId };
}

export const roomTrunkHandlers: GatewayRequestHandlers = {
  "rooms.trunk.list": (options) => {
    try {
      const trunkId = callingTrunkId();
      const rooms = listRooms(false)
        .filter((room) => isEnabledTrunkMember(room, trunkId))
        .map((room) => ({
          roomId: room.roomId,
          name: room.name,
          lead: room.lead,
          rule: room.rule,
          trunksTalk: room.trunksTalk,
          members: room.members.filter((m) => m.enabled).map((m) => `${m.kind}:${m.id}`),
        }));
      options.respond(true, { rooms });
    } catch (error) {
      respondFailure(options.respond, error);
    }
  },
  "rooms.trunk.read": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsLogParams,
        "rooms.trunk.read",
        options.respond,
      )
    ) {
      return;
    }
    try {
      const { room } = callingTrunkRoom(options.params.roomId);
      options.respond(true, readRoomLog(room.roomId, options.params.cursor, options.params.limit));
    } catch (error) {
      respondFailure(options.respond, error);
    }
  },
  "rooms.trunk.post": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsSendParams,
        "rooms.trunk.post",
        options.respond,
      )
    ) {
      return;
    }
    try {
      if (options.params.outsideAgent) {
        throw new Error("A Trunk posts as itself, not as an outside agent");
      }
      if (!options.params.message.trim()) {
        throw new Error("Room message must not be blank");
      }
      const { room, trunkId } = callingTrunkRoom(options.params.roomId);
      // A Trunk's post is recorded only. It never starts a turn, so posting cannot chain runs.
      const posted = appendRoomEvent(room.roomId, "message", trunkId, {
        text: options.params.message,
      });
      options.context.broadcast("rooms.event", posted, { dropIfSlow: true });
      options.respond(true, { event: posted });
    } catch (error) {
      respondFailure(options.respond, error);
    }
  },
};
