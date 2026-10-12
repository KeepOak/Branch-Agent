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
import { waitForAgentRunReply } from "../../agents/run-wait.js";
import { isNonDeliverableSessionsReply } from "../../agents/tools/sessions-send-tokens.js";
import { matchesMentionPatterns } from "../../auto-reply/reply/mentions.js";
import { persistSessionTranscriptTurn } from "../../config/sessions/session-accessor.js";
import { escapeRegExp } from "../../utils.js";
import { listGatewayAgentsBasic } from "../agent-list.js";
import {
  graftDeviceId,
  graftSendRefusal,
  listOutsideAgents,
  outsideAgentMayMessage,
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
import { agentWaitHandler } from "./agent-wait.js";
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

function outsideRoomRefusal(
  options: GatewayRequestHandlerOptions,
  room: Room,
  outside?: OutsideSender,
): string | undefined {
  const deviceRefusal = graftSendRefusal(outside?.id, graftDeviceId(options.client));
  if (deviceRefusal) {
    return `${deviceRefusal} Reconnect through your own Graft and try again.`;
  }
  if (!outside) {
    return undefined;
  }
  const refusal = outsideAgentRefusal(outside);
  if (refusal) {
    return `${refusal} Ask the owner to allow this agent there, then reconnect Graft.`;
  }
  const cfg = options.context.getRuntimeConfig();
  for (const member of room.members) {
    if (
      member.kind === "trunk" &&
      member.enabled &&
      !outsideAgentMayMessage(cfg, member.id, outside.id)
    ) {
      return `${outside.name} may not join or post in this group chat because ${member.id}'s "Who it knows" switch is off. Ask the owner to turn it on for this agent.`;
    }
  }
  return undefined;
}
type Roster = Awaited<ReturnType<typeof listGatewayAgentsBasic>>;
type RoomTurn = Awaited<ReturnType<typeof dispatchTrunk>>;

/** Trunk-to-Trunk turns one owner post may start before the room stops the exchange. */
const TRUNK_TALK_ROUNDS = 6;
/** One agent.wait observation, as sessions_send's agent-to-agent flow; untilTerminal repeats it. */
const ROOM_REPLY_WAIT_MS = 60_000;

function mentionedMembers(
  message: string,
  room: Room,
  roster: Roster,
  options: { outside?: OutsideSender; atOnly?: boolean } = {},
) {
  // Follow OpenClaw's derived-name boundary policy in auto-reply/reply/mentions.ts:
  // a plain name or @name activates, but a name inside another word does not.
  // Trunk replies wake another Trunk only through an explicit @mention.
  const outside = options.outside;
  const names = new Map(roster.agents.map((agent) => [agent.id, agent.name]));
  const outsideNames = new Map(listOutsideAgents().map((agent) => [agent.id, agent.name]));
  return room.members.filter((member) => {
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
      ...(name
        ? [
            new RegExp(
              `${boundary}@${options.atOnly ? "" : "?"}${escapeRegExp(name)}${ending}`,
              "iu",
            ),
          ]
        : []),
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

/** Start one Trunk's turn in its own room conversation. */
async function dispatchTrunk(
  options: GatewayRequestHandlerOptions,
  room: Room,
  agentId: string | undefined,
  message: string,
  outside?: OutsideSender,
) {
  const label = agentId === room.lead ? "Lead" : "Trunk";
  if (
    !agentId ||
    !room.members.some(
      (member) => member.kind === "trunk" && member.id === agentId && member.enabled,
    )
  )
    throw new Error(
      agentId && agentId !== room.lead
        ? `${agentId} is not an enabled Trunk in this group chat`
        : "Room has no enabled lead Trunk",
    );
  const lead = agentId;
  await checkTrunks(options, [lead]);
  const sessionKey = `agent:${lead}:room:${room.roomId}`;
  const exists = !!loadGatewaySessionEntryReadOnly(sessionKey, { agentId: lead }).entry?.sessionId;
  let response: Awaited<ReturnType<typeof forward>>;
  if (outside) {
    // The Trunk's room conversation first (without a message), then the post through chat.send as the agent.
    if (!exists) {
      const created = await forward(options, sessionCreateHandlers["sessions.create"]!, {
        key: sessionKey,
        agentId: lead,
      });
      if (!created?.ok)
        throw new Error(created?.error?.message ?? `${label} conversation not created`);
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
  if (!response?.ok) throw new Error(response?.error?.message ?? `${label} turn was not accepted`);
  const runStarted =
    response.payload?.runStarted === true || typeof response.payload?.runId === "string";
  if (!runStarted) throw new Error(`${label} turn was not started`);
  return {
    sessionKey,
    runId: typeof response.payload?.runId === "string" ? response.payload.runId : undefined,
    runStarted,
  };
}

async function startRoomTurn(
  options: GatewayRequestHandlerOptions,
  room: Room,
  agentId: string | undefined,
  message: string,
  outside?: OutsideSender,
) {
  const turn = await dispatchTrunk(options, room, agentId, message, outside);
  event(
    options,
    appendRoomEvent(room.roomId, "turn.started", agentId!, {
      sessionKey: turn.sessionKey,
      ...(turn.runId ? { runId: turn.runId } : {}),
    }),
  );
  return turn;
}

/** Wait for a started turn through agent.wait and record its visible reply in the room log. */
async function awaitRoomReply(
  options: GatewayRequestHandlerOptions,
  room: Room,
  agentId: string,
  turn: RoomTurn,
) {
  if (!turn.runId) return undefined;
  const callGateway = (async (request: { params?: unknown }) => {
    const response = await forward(
      options,
      agentWaitHandler,
      request.params as Record<string, unknown>,
    );
    if (!response?.ok) throw new Error(response?.error?.message ?? "Trunk turn was not found");
    return response.payload;
  }) as unknown as Parameters<typeof waitForAgentRunReply>[0]["callGateway"];
  const wait = await waitForAgentRunReply({
    runId: turn.runId,
    timeoutMs: ROOM_REPLY_WAIT_MS,
    callGateway,
    untilTerminal: true,
  });
  if (wait.status !== "ok") throw new Error(wait.error ?? `Trunk turn ended: ${wait.status}`);
  const text = wait.replyText?.trim();
  if (!text || isNonDeliverableSessionsReply(text)) return undefined;
  event(
    options,
    appendRoomEvent(room.roomId, "turn.replied", agentId, {
      sessionKey: turn.sessionKey,
      runId: turn.runId,
      text,
    }),
  );
  return text;
}

/** A failed turn is recorded and the room moves on to the next Trunk. */
async function settleRoomTurn(
  options: GatewayRequestHandlerOptions,
  room: Room,
  agentId: string,
  run: () => Promise<string | undefined>,
) {
  try {
    return await run();
  } catch (error) {
    try {
      event(
        options,
        appendRoomEvent(room.roomId, "turn.failed", agentId, {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } catch {
      // The room was archived or its history is full; nothing more can be recorded.
    }
    return undefined;
  }
}

/**
 * After the first turn of an owner post: with rule "everyone" the other Trunks take their turns
 * in member order, each seeing the replies before it; with trunksTalk an @mention in a Trunk's
 * reply wakes that Trunk, up to TRUNK_TALK_ROUNDS Trunk-to-Trunk turns per owner post.
 */
async function continueRoomTurns(
  options: GatewayRequestHandlerOptions,
  room: Room,
  message: string,
  outside: OutsideSender | undefined,
  first: { agentId: string; turn: RoomTurn },
  rest: string[],
) {
  const roster = await listGatewayAgentsBasic(options.context.getRuntimeConfig());
  const name = (id: string) => roster.agents.find((agent) => agent.id === id)?.name ?? id;
  const said = (reply: { agentId: string; text: string }) =>
    `${name(reply.agentId)}: ${reply.text}`;
  const order = [first.agentId, ...rest];
  const replies: { agentId: string; text: string; seenBy: Set<string> }[] = [];
  for (const [index, agentId] of order.entries()) {
    const text = await settleRoomTurn(options, room, agentId, async () => {
      const turn =
        index === 0
          ? first.turn
          : await startRoomTurn(
              options,
              room,
              agentId,
              replies.length
                ? `${message}\n\nEarlier replies in this group chat:\n\n${replies.map(said).join("\n\n")}`
                : message,
              outside,
            );
      return await awaitRoomReply(options, room, agentId, turn);
    });
    if (text) replies.push({ agentId, text, seenBy: new Set(order.slice(index + 1)) });
  }
  if (!room.trunksTalk) return;
  let rounds = 0;
  for (let index = 0; index < replies.length; index += 1) {
    const from = replies[index]!;
    for (const target of mentionedMembers(from.text, room, roster, { atOnly: true })) {
      if (target.kind !== "trunk" || target.id === from.agentId || from.seenBy.has(target.id))
        continue;
      if (rounds >= TRUNK_TALK_ROUNDS) {
        event(
          options,
          appendRoomEvent(room.roomId, "note", "room", {
            text: `Trunks stopped after ${TRUNK_TALK_ROUNDS} back-and-forth turns. Post again to continue.`,
          }),
        );
        return;
      }
      rounds += 1;
      const text = await settleRoomTurn(options, room, target.id, async () =>
        awaitRoomReply(
          options,
          room,
          target.id,
          await startRoomTurn(options, room, target.id, said(from)),
        ),
      );
      if (text) replies.push({ agentId: target.id, text, seenBy: new Set() });
    }
  }
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
      const started = appendRoomEvent(room.roomId, "created", "owner", {
        members: room.members.map(({ kind, id }) => ({ kind, id })),
      });
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
    const refusal = outsideRoomRefusal(options, room, outside);
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
      failure(
        options.respond,
        new Error(
          `${outside.name} is not a member of this group chat. Use room_join before posting.`,
        ),
      );
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
        if (!mentionedMembers(options.params.message, room, roster, { outside }).length) {
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
      // Rule "everyone": every enabled Trunk takes a turn in member order; otherwise the lead answers.
      const order =
        room.rule === "everyone"
          ? room.members
              .filter((member) => member.kind === "trunk" && member.enabled)
              .map((member) => member.id)
          : [room.lead];
      try {
        // An outside agent's post reaches a Trunk as that agent's own message (chat.send outsideAgent: its name,
        // face and A2A badge in the thread), never as the owner's.
        const first = order[0];
        const turn = await startRoomTurn(options, room, first, options.params.message, outside);
        options.respond(true, { event: posted, ...turn });
        if (order.length > 1 || room.trunksTalk) {
          void continueRoomTurns(
            options,
            room,
            options.params.message,
            outside,
            { agentId: first!, turn },
            order.slice(1) as string[],
          ).catch(() => undefined);
        }
      } catch (error) {
        const failed = appendRoomEvent(room.roomId, "turn.failed", order[0] ?? "room", {
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
      const outside = options.params.outsideAgent;
      if (outside && (options.params.kind !== "a2a" || options.params.id !== outside.id)) {
        throw new Error(
          "An outside agent can join only as its own identity. Use room_join without changing the member id.",
        );
      }
      const current = getRoom(options.params.roomId);
      if (!current || current.archivedAt !== undefined) {
        throw new Error("Room not found");
      }
      const refusal = outsideRoomRefusal(options, current, outside);
      if (refusal) {
        throw new Error(refusal);
      }
      const room = addRoomMember(options.params.roomId, options.params);
      const actorId =
        outside && options.params.kind === "a2a" && options.params.id === outside.id
          ? `a2a:${outside.id}`
          : (options.client?.authenticatedUserProfile?.profileId ?? "owner");
      const added = appendRoomEvent(room.roomId, "member.added", actorId, {
        kind: options.params.kind,
        id: options.params.id,
        ...(outside ? { from: outside.name } : {}),
      });
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
