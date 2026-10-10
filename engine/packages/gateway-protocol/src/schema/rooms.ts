import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { OutsideAgentSchema } from "./contacts.js";
import { NonEmptyString } from "./primitives.js";

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Name = Type.String({ minLength: 1, maxLength: 200 });
const Kind = Type.Union([Type.Literal("trunk"), Type.Literal("person"), Type.Literal("a2a")]);
const Rule = Type.Union([Type.Literal("lead"), Type.Literal("everyone"), Type.Literal("mentions")]);
export const RoomMemberSchema = closedObject({
  roomId: Id,
  kind: Kind,
  id: Id,
  order: Type.Integer({ minimum: 0 }),
  role: Type.Union([Type.Literal("lead"), Type.Literal("member")]),
  enabled: Type.Boolean(),
});
export const RoomSchema = closedObject({
  roomId: Id,
  name: Name,
  createdAt: Type.Integer({ minimum: 0 }),
  lead: Type.Optional(Id),
  rule: Rule,
  trunksTalk: Type.Boolean(),
  memoryScope: Type.Literal("room"),
  pinnedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  archivedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  members: Type.Array(RoomMemberSchema),
});
export const RoomEventSchema = closedObject({
  roomId: Id,
  seq: Type.Integer({ minimum: 1 }),
  eventId: Id,
  kind: NonEmptyString,
  actorId: Id,
  payload: Type.Unknown(),
  createdAt: Type.Integer({ minimum: 0 }),
});
export const RoomsCreateParamsSchema = closedObject({
  name: Name,
  members: Type.Array(
    closedObject({
      kind: Kind,
      id: Id,
      role: Type.Optional(Type.Union([Type.Literal("lead"), Type.Literal("member")])),
      enabled: Type.Optional(Type.Boolean()),
    }),
    { minItems: 1, maxItems: 500 },
  ),
  rule: Type.Optional(Rule),
  trunksTalk: Type.Optional(Type.Boolean()),
});
export const RoomsGetParamsSchema = closedObject({ roomId: Id });
export const RoomsListParamsSchema = closedObject({
  includeArchived: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
export const RoomsSendParamsSchema = closedObject({
  roomId: Id,
  message: NonEmptyString,
  outsideAgent: Type.Optional(OutsideAgentSchema),
});
export const RoomsLogParamsSchema = closedObject({
  roomId: Id,
  cursor: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
export const RoomsMembersAddParamsSchema = closedObject({
  roomId: Id,
  kind: Kind,
  id: Id,
  outsideAgent: Type.Optional(OutsideAgentSchema),
});
export const RoomsMembersRemoveParamsSchema = closedObject({ roomId: Id, kind: Kind, id: Id });
export const RoomsRuleSetParamsSchema = closedObject({
  roomId: Id,
  rule: Rule,
  trunksTalk: Type.Optional(Type.Boolean()),
});
export const RoomsArchiveParamsSchema = closedObject({ roomId: Id });
export const RoomsMergeRecordParamsSchema = closedObject({
  roomId: Id,
  repo: Type.String({ minLength: 3, maxLength: 100, pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" }),
  number: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 500 }),
});
export const RoomsRoomResultSchema = closedObject({ room: RoomSchema });
export const RoomsListResultSchema = closedObject({ rooms: Type.Array(RoomSchema) });
export const RoomsLogResultSchema = closedObject({
  events: Type.Array(RoomEventSchema),
  nextCursor: Type.Optional(Type.Integer({ minimum: 1 })),
});
export const RoomsSendResultSchema = closedObject({
  event: RoomEventSchema,
  sessionKey: NonEmptyString,
  runId: Type.Optional(NonEmptyString),
  runStarted: Type.Boolean(),
});
export type RoomsCreateParams = Static<typeof RoomsCreateParamsSchema>;
