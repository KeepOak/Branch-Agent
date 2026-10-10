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
      trunks: Type.Optional(Type.Array(closedObject({ name: NonEmptyString, avatar: Type.Optional(Type.String()) }))),
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
  /** A person or agent explicitly named this thread; do not shorten its title in the UI. */
  labelled: Type.Optional(Type.Boolean()),
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
export const ContactsMarkReadParamsSchema = closedObject({
  contactId: NonEmptyString,
  mutationId: Type.Optional(NonEmptyString),
});
export const ContactsMarkReadResultSchema = closedObject({ updated: Type.Integer({ minimum: 0 }) });
/** Marks every thread read, or only `sessionKeys`. Reads and writes shared state, never an agent's own database. */
export const ContactsMarkAllReadParamsSchema = closedObject({
  mutationId: NonEmptyString,
  sessionKeys: Type.Optional(Type.Array(NonEmptyString, { minItems: 1, maxItems: 500 })),
});
export const ContactsMarkAllReadResultSchema = closedObject({
  applied: Type.Boolean(),
  readThroughMs: Type.Integer({ minimum: 0 }),
});
/** An outside agent speaking through `branch mcp serve`: contact `a2a:<id>`, drawn as an A2A agent. */
export const OutsideAgentSchema = closedObject({
  id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  version: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  where: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  project: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  // One running client (a random tag per process), so two sessions with the same name, computer and folder
  // become two contacts.
  instance: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  activity: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  // Branch-to-Branch: another Branch grafted in as a device ("branch") and its Trunks ("trunk", via that Branch).
  kind: Type.Optional(Type.Union([Type.Literal("branch"), Type.Literal("trunk")])),
  via: Type.Optional(Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" })),
  avatar: Type.Optional(Type.String({ pattern: "^branch:[a-z0-9-]{1,32}$" })),
  trunkId: Type.Optional(Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" })),
});
/** `leaving: true` is the goodbye a client sends when it exits: its id is free for the next session at once. */
export const ContactsOutsideHelloParamsSchema = closedObject({
  agent: OutsideAgentSchema,
  leaving: Type.Optional(Type.Boolean()),
});
export const ContactsOutsideListParamsSchema = closedObject({});
/** Settings › Connected agents: the master switch, or one agent's disconnect / window permission. */
export const ContactsOutsideSetParamsSchema = closedObject({
  enabled: Type.Optional(Type.Boolean()),
  id: Type.Optional(OutsideAgentSchema.properties.id),
  revoked: Type.Optional(Type.Boolean()),
  mayDriveWindow: Type.Optional(Type.Boolean()),
});
export type OutsideAgentParams = Static<typeof OutsideAgentSchema>;
export type ContactsOutsideHelloParams = Static<typeof ContactsOutsideHelloParamsSchema>;
export type Contact = Static<typeof ContactSchema>;
export type Topic = Static<typeof TopicSchema>;
export type ContactsListParams = Static<typeof ContactsListParamsSchema>;
export type ContactsTopicsParams = Static<typeof ContactsTopicsParamsSchema>;
export type ContactsMarkReadParams = Static<typeof ContactsMarkReadParamsSchema>;
export type ContactsMarkAllReadParams = Static<typeof ContactsMarkAllReadParamsSchema>;
