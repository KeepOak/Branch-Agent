import { randomUUID } from "node:crypto";
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
import { matchesMentionPatterns } from "../../auto-reply/reply/mentions.js";
import { persistSessionTranscriptTurn } from "../../config/sessions/session-accessor.js";
import { escapeRegExp } from "../../utils.js";
import { listGatewayAgentsBasic } from "../agent-list.js";
import {
  listOutsideAgents,
  outsideAgentRefusal,
  outsideAgentSender,
  type OutsideAgent,
} from "../contacts/outside-agents.js";
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
import { handleDirectExternalChatSend } from "./chat-send-external-entry.js";
import { gatewayClientSenderFields } from "./gateway-client-identity.js";
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
type OutsideSender = Pick<OutsideAgent, "id" | "name">;

function mentionsEnabledMember(
  message: string,
  room: Room,
  roster: Awaited<ReturnType<typeof listGatewayAgentsBasic>>,
  outside?: OutsideSender,
) {
  // Follow OpenClaw's derived-name boundary policy in auto-reply/reply/mentions.ts:
  // a plain name or @name activates, but a name inside another word does not.
  const names = new Map(roster.agents.map((agent) => [agent.id, agent.name]));
  const outsideNames = new Map(listOutsideAgents().map((agent) => [agent.id, agent.name]));
  return room.members.some((member) => {
    if (!member.enabled) return false;
    const name =
      member.kind === "trunk"
        ? names.get(member.id)
        : member.kind === "a2a" && member.id !== outside?.id
          ? outsideNames.get(member.id)
          : undefined;
    const boundary = "(?:^|[^\\p{L}\\p{N}\\p{Pc}])";
    const ending = "(?![\\p{L}\\p{N}\\p{Pc}])";
    return matchesMentionPatterns(message, [
      new RegExp(`${boundary}@${escapeRegExp(member.id)}${ending}`, "iu"),
      ...(name ? [new RegExp(`${boundary}@?${escapeRegExp(name)}${ending}`, "iu")] : []),
    ]);
  });
}

async function appendRoomPostWithoutTurn(
  options: GatewayRequestHandlerOptions,
  room: Room,
  message: string,
  outside?: OutsideSender,
) {
  const lead = room.lead;
  if (
    !lead ||
    !room.members.some((member) => member.kind === "trunk" && member.id === lead && member.enabled)
  )
    throw new Error("Room has no enabled lead Trunk");
  await checkTrunks(options, [lead]);
  const sessionKey = `agent:${lead}:room:${room.roomId}`;
  let session = loadGatewaySessionEntryReadOnly(sessionKey, { agentId: lead });
  if (!session.entry?.sessionId) {
    const created = await forward(options, sessionCreateHandlers["sessions.create"]!, {
      key: sessionKey,
      agentId: lead,
    });
    if (!created?.ok) throw new Error(created?.error?.message ?? "Lead conversation not created");
    session = loadGatewaySessionEntryReadOnly(sessionKey, { agentId: lead });
  }
  if (!session.entry?.sessionId) throw new Error("Lead conversation not found");
  const sender = outside
    ? outsideAgentSender(outside)
    : gatewayClientSenderFields(options.client).sender;
  const result = await persistSessionTranscriptTurn(
    {
      sessionKey,
      sessionId: session.entry.sessionId,
      agentId: lead,
      storePath: session.storePath,
    },
    {
      expectedSessionId: session.entry.sessionId,
      updateMode: "inline",
      touchSessionEntry: true,
      messages: [
        {
          message: {
            role: "user",
            content: message,
            timestamp: Date.now(),
            __branch: {
              ...(sender?.id ? { senderId: sender.id } : {}),
              ...(sender?.name ? { senderName: sender.name } : {}),
              ...(sender?.identity ? { senderIdentity: sender.identity } : {}),
              ...(!outside && options.client?.connect?.scopes?.includes("operator.admin")
                ? { senderIsOwner: true }
                : {}),
            },
          },
        },
      ],
    },
  );
  if (result.rejectedReason || result.messages.length !== 1)
    throw new Error(result.rejectedReason ?? "Room post was not written to the conversation");
  return sessionKey;
}

/** Run one handler as an internal step of rooms.send and return what it answered. */
async function forward(
  options: GatewayRequestHandlerOptions,
  handler: (options: GatewayRequestHandlerOptions) => Promise<void> | void,
  params: Record<string, unknown>,
) {
  let response:
    | { ok: boolean; payload?: Record<string, unknown>; error?: { message?: string } }
    | undefined;
  const forwarded = bindGatewayRequestHandlerMutationAuthority(
    options,
    {
      ...options,
      params,
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
  await handler(forwarded);
  return response;
}

async function dispatchLead(
  options: GatewayRequestHandlerOptions,
  room: Room,
  message: string,
  outside?: OutsideSender,
) {
  const lead = room.lead;
  if (
    !lead ||
    !room.members.some((member) => member.kind === "trunk" && member.id === lead && member.enabled)
  )
    throw new Error("Room has no enabled lead Trunk");
  await checkTrunks(options, [lead]);
  const sessionKey = `agent:${lead}:room:${room.roomId}`;
  const exists = !!loadGatewaySessionEntryReadOnly(sessionKey, { agentId: lead }).entry?.sessionId;
  let response: Awaited<ReturnType<typeof forward>>;
  if (outside) {
    // The lead's room conversation first (without a message), then the post through chat.send as the agent.
    if (!exists) {
      const created = await forward(options, sessionCreateHandlers["sessions.create"]!, {
        key: sessionKey,
        agentId: lead,
      });
      if (!created?.ok) throw new Error(created?.error?.message ?? "Lead conversation not created");
    }
    response = await forward(options, handleDirectExternalChatSend, {
      sessionKey,
      agentId: lead,
      message,
      deliver: false,
      idempotencyKey: randomUUID(),
      outsideAgent: outside,
    });
  } else {
    response = await forward(
      options,
      exists
        ? sessionMessagingHandlers["sessions.send"]!
        : sessionCreateHandlers["sessions.create"]!,
      { key: sessionKey, agentId: lead, message },
    );
  }
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
      const started = appendRoomEvent(room.roomId, "created", "owner", { members: room.members.map(({ kind, id }) => ({ kind, id })) });
      changed(options, room);
      event(options, started);
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
      if (room.rule === "mentions") {
        const roster = await listGatewayAgentsBasic(options.context.getRuntimeConfig());
        if (!mentionsEnabledMember(options.params.message, room, roster, outside)) {
          try {
            const sessionKey = await appendRoomPostWithoutTurn(
              options,
              room,
              options.params.message,
              outside,
            );
            event(options, posted);
            options.respond(true, { event: posted, sessionKey, runStarted: false });
          } catch (error) {
            event(options, posted);
            failure(options.respond, error);
          }
          return;
        }
      }
      event(options, posted);
      try {
        // An outside agent's post reaches the lead as that agent's own message (chat.send outsideAgent: its name,
        // face and A2A badge in the thread), never as the owner's.
        const turn = await dispatchLead(options, room, options.params.message, outside);
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
      const outside = options.params.outsideAgent;
      const actorId = outside && options.params.kind === "a2a" && options.params.id === outside.id
        ? `a2a:${outside.id}`
        : (options.client?.authenticatedUserProfile?.profileId ?? "owner");
      const added = appendRoomEvent(room.roomId, "member.added", actorId, { kind: options.params.kind, id: options.params.id, ...(outside ? { from: outside.name } : {}) });
      changed(options, room);
      event(options, added);
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
