import {
  ErrorCodes,
  errorShape,
  validateRoomsArchiveParams,
  validateRoomsCreateParams,
  validateRoomsGetParams,
  validateRoomsListParams,
  validateRoomsLogParams,
  validateRoomsMembersAddParams,
  validateRoomsMembersRemoveParams,
  validateRoomsRuleSetParams,
  validateRoomsSendParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { listGatewayAgentsBasic } from "../agent-list.js";
import { outsideAgentRefusal } from "../contacts/outside-agents.js";
import { authorizeGatewaySessionCreation } from "../operator-role-policy.js";
import {
  addRoomMember,
  appendRoomEvent,
  archiveRoom,
  createRoom,
  getRoom,
  listRooms,
  readRoomLog,
  removeRoomMember,
  setRoomRule,
  type Room,
  type RoomEvent,
} from "../rooms/store.js";
import { loadGatewaySessionEntryReadOnly } from "../session-utils.js";
import { bindGatewayRequestHandlerMutationAuthority } from "./session-mutation-guards.js";
import { sessionCreateHandlers } from "./sessions-create.js";
import { sessionMessagingHandlers } from "./sessions-messaging.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

function failure(respond: RespondFn, error: unknown) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
}
function changed(options: GatewayRequestHandlerOptions, room: Room) {
  options.context.broadcast("rooms.changed", { roomId: room.roomId, room }, { dropIfSlow: true });
}
function event(options: GatewayRequestHandlerOptions, value: RoomEvent) {
  options.context.broadcast("rooms.event", value, { dropIfSlow: true });
}
async function checkTrunks(options: GatewayRequestHandlerOptions, ids: string[]) {
  const cfg = options.context.getRuntimeConfig();
  const roster = await listGatewayAgentsBasic(cfg);
  const known = new Set(
    roster.agents.filter((agent) => agent.kind !== "system").map((agent) => agent.id),
  );
  for (const agentId of ids) {
    if (!known.has(agentId)) throw new Error(`Unknown Trunk: ${agentId}`);
    const error = authorizeGatewaySessionCreation({ cfg, client: options.client, agentId });
    if (error) throw new Error(error.message);
  }
}
async function dispatchLead(options: GatewayRequestHandlerOptions, room: Room, message: string) {
  const lead = room.lead;
  if (
    !lead ||
    !room.members.some((member) => member.kind === "trunk" && member.id === lead && member.enabled)
  )
    throw new Error("Room has no enabled lead Trunk");
  await checkTrunks(options, [lead]);
  const sessionKey = `agent:${lead}:room:${room.roomId}`;
  const exists = !!loadGatewaySessionEntryReadOnly(sessionKey, { agentId: lead }).entry?.sessionId;
  let response:
    | { ok: boolean; payload?: Record<string, unknown>; error?: { message?: string } }
    | undefined;
  const forwarded = bindGatewayRequestHandlerMutationAuthority(
    options,
    {
      ...options,
      params: { key: sessionKey, agentId: lead, message },
      respond: (ok, payload, error) => {
        response = {
          ok,
          payload:
            payload && typeof payload === "object"
              ? (payload as Record<string, unknown>)
              : undefined,
          error,
        };
      },
    },
    undefined,
  );
  await (
    exists ? sessionMessagingHandlers["sessions.send"]! : sessionCreateHandlers["sessions.create"]!
  )(forwarded);
  if (!response?.ok) throw new Error(response?.error?.message ?? "Lead turn was not accepted");
  const runStarted =
    response.payload?.runStarted === true || typeof response.payload?.runId === "string";
  if (!runStarted) throw new Error("Lead turn was not started");
  return {
    sessionKey,
    runId: typeof response.payload?.runId === "string" ? response.payload.runId : undefined,
    runStarted,
  };
}

export const roomHandlers: GatewayRequestHandlers = {
  "rooms.create": async (options) => {
    if (
      !assertValidParams(options.params, validateRoomsCreateParams, "rooms.create", options.respond)
    )
      return;
    try {
      await checkTrunks(
        options,
        options.params.members
          .filter((member) => member.kind === "trunk")
          .map((member) => member.id),
      );
      const room = createRoom({
        ...options.params,
        members: options.params.members.map((member) => ({
          ...member,
          role: member.role ?? "member",
          enabled: member.enabled ?? true,
        })),
      });
      changed(options, room);
      options.respond(true, { room });
    } catch (error) {
      failure(options.respond, error);
    }
  },
  "rooms.get": (options) => {
    if (!assertValidParams(options.params, validateRoomsGetParams, "rooms.get", options.respond))
      return;
    const room = getRoom(options.params.roomId);
    room ? options.respond(true, { room }) : failure(options.respond, new Error("Room not found"));
  },
  "rooms.list": (options) => {
    if (!assertValidParams(options.params, validateRoomsListParams, "rooms.list", options.respond))
      return;
    options.respond(true, {
      rooms: listRooms(options.params.includeArchived, options.params.limit),
    });
  },
  "rooms.send": async (options) => {
    if (!assertValidParams(options.params, validateRoomsSendParams, "rooms.send", options.respond))
      return;
    if (!options.params.message.trim()) {
      failure(options.respond, new Error("Room message must not be blank"));
      return;
    }
    const room = getRoom(options.params.roomId);
    if (!room || room.archivedAt !== undefined) {
      failure(options.respond, new Error("Room not found"));
      return;
    }
    const outside = options.params.outsideAgent;
    const refusal = outside ? outsideAgentRefusal(outside) : undefined;
    if (refusal) {
      failure(options.respond, new Error(refusal));
      return;
    }
    if (
      outside &&
      !room.members.some(
        (member) => member.kind === "a2a" && member.id === outside.id && member.enabled,
      )
    ) {
      failure(options.respond, new Error(`${outside.name} is not a member of this group chat`));
      return;
    }
    try {
      // The user's message is committed before the hidden lead turn is admitted.
      // A failed admission stays visible and retryable, never silently discarded.
      const posted = appendRoomEvent(
        room.roomId,
        "message",
        outside
          ? `a2a:${outside.id}`
          : (options.client?.authenticatedUserProfile?.profileId ?? "owner"),
        { text: options.params.message, ...(outside ? { from: outside.name } : {}) },
      );
      event(options, posted);
      try {
        // The lead Trunk is told who spoke when it isn't the owner.
        const leadMessage = outside
          ? `${outside.name} (outside agent) wrote in the group chat:
${options.params.message}`
          : options.params.message;
        const turn = await dispatchLead(options, room, leadMessage);
        const started = appendRoomEvent(room.roomId, "turn.started", room.lead!, {
          sessionKey: turn.sessionKey,
          ...(turn.runId ? { runId: turn.runId } : {}),
        });
        event(options, started);
        options.respond(true, { event: posted, ...turn });
      } catch (error) {
        const failed = appendRoomEvent(room.roomId, "turn.failed", room.lead ?? "room", {
          message: error instanceof Error ? error.message : String(error),
        });
        event(options, failed);
        failure(options.respond, error);
      }
    } catch (error) {
      failure(options.respond, error);
    }
  },
  "rooms.log": (options) => {
    if (!assertValidParams(options.params, validateRoomsLogParams, "rooms.log", options.respond))
      return;
    try {
      options.respond(
        true,
        readRoomLog(options.params.roomId, options.params.cursor, options.params.limit),
      );
    } catch (error) {
      failure(options.respond, error);
    }
  },
  "rooms.members.add": async (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsMembersAddParams,
        "rooms.members.add",
        options.respond,
      )
    )
      return;
    try {
      if (options.params.kind === "trunk") await checkTrunks(options, [options.params.id]);
      const room = addRoomMember(options.params.roomId, options.params);
      changed(options, room);
      options.respond(true, { room });
    } catch (error) {
      failure(options.respond, error);
    }
  },
  "rooms.members.remove": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsMembersRemoveParams,
        "rooms.members.remove",
        options.respond,
      )
    )
      return;
    try {
      const room = removeRoomMember(options.params.roomId, options.params.kind, options.params.id);
      changed(options, room);
      options.respond(true, { room });
    } catch (error) {
      failure(options.respond, error);
    }
  },
  "rooms.rule.set": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsRuleSetParams,
        "rooms.rule.set",
        options.respond,
      )
    )
      return;
    try {
      const room = setRoomRule(
        options.params.roomId,
        options.params.rule,
        options.params.trunksTalk ?? getRoom(options.params.roomId)?.trunksTalk ?? false,
      );
      changed(options, room);
      options.respond(true, { room });
    } catch (error) {
      failure(options.respond, error);
    }
  },
  "rooms.archive": (options) => {
    if (
      !assertValidParams(
        options.params,
        validateRoomsArchiveParams,
        "rooms.archive",
        options.respond,
      )
    )
      return;
    try {
      const room = archiveRoom(options.params.roomId);
      changed(options, room);
      options.respond(true, { room });
    } catch (error) {
      failure(options.respond, error);
    }
  },
};
