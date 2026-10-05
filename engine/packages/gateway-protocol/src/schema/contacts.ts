import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

const Timestamp = Type.Number({ minimum: 0 });
export const ContactPreviewSchema = Type.Union([
  closedObject({ kind: Type.Literal("message"), text: Type.String(), at: Timestamp }),
  closedObject({
    kind: Type.Literal("topic"),
    topicKey: NonEmptyString,
    title: NonEmptyString,
    text: Type.String(),
    at: Timestamp,
  }),
]);
export const ContactSchema = closedObject({
  id: NonEmptyString,
  kind: Type.Union([
    Type.Literal("trunk"),
    Type.Literal("group"),
    Type.Literal("chatGroup"),
    Type.Literal("outside"),
  ]),
  name: NonEmptyString,
  where: Type.Optional(Type.String()),
  card: Type.Optional(
    closedObject({
      name: NonEmptyString,
      description: Type.String(),
      iconUrl: Type.Optional(Type.String()),
      skills: Type.Array(
        closedObject({ name: NonEmptyString, description: Type.Optional(Type.String()) }),
      ),
      fetchedAt: Timestamp,
    }),
  ),
  face: Type.Optional(
    closedObject({
      agentId: Type.Optional(NonEmptyString),
      iconUrl: Type.Optional(Type.String()),
      members: Type.Optional(Type.Array(NonEmptyString)),
    }),
  ),
  threadKey: NonEmptyString,
  isDefault: Type.Boolean(),
  pinnedAt: Type.Optional(Timestamp),
  archivedAt: Type.Optional(Timestamp),
  lastActivityAt: Timestamp,
  preview: ContactPreviewSchema,
  unreadTopics: Type.Integer({ minimum: 0 }),
  threadUnread: Type.Boolean(),
  needsYou: Type.Boolean(),
  working: Type.Boolean(),
  topicCount: Type.Integer({ minimum: 0 }),
});
export const TopicSchema = closedObject({
  key: NonEmptyString,
  contactId: NonEmptyString,
  title: NonEmptyString,
  anchor: Type.Optional(
    closedObject({
      threadKey: NonEmptyString,
      afterMessageId: Type.Optional(NonEmptyString),
      at: Timestamp,
    }),
  ),
  status: Type.Union([
    Type.Literal("active"),
    Type.Literal("working"),
    Type.Literal("waiting"),
    Type.Literal("done"),
    Type.Literal("archived"),
  ]),
  unread: Type.Boolean(),
  pinnedAt: Type.Optional(Timestamp),
  projectId: Type.Optional(NonEmptyString),
  folder: Type.Optional(NonEmptyString),
  ownerId: Type.Optional(NonEmptyString),
});
export const ContactsListParamsSchema = closedObject({
  includeArchived: Type.Optional(Type.Boolean()),
});
export const ContactsListResultSchema = closedObject({
  contacts: Type.Array(ContactSchema),
  defaultId: NonEmptyString,
});
export const ContactsTopicsParamsSchema = closedObject({
  contactId: NonEmptyString,
  status: Type.Optional(TopicSchema.properties.status),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  cursor: Type.Optional(NonEmptyString),
});
export const ContactsTopicsResultSchema = closedObject({
  topics: Type.Array(TopicSchema),
  nextCursor: Type.Optional(NonEmptyString),
});
export const ContactsMarkReadParamsSchema = closedObject({ contactId: NonEmptyString });
export const ContactsMarkReadResultSchema = closedObject({ updated: Type.Integer({ minimum: 0 }) });
export type Contact = Static<typeof ContactSchema>;
export type Topic = Static<typeof TopicSchema>;
export type ContactsListParams = Static<typeof ContactsListParamsSchema>;
export type ContactsTopicsParams = Static<typeof ContactsTopicsParamsSchema>;
export type ContactsMarkReadParams = Static<typeof ContactsMarkReadParamsSchema>;
