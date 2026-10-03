import { jsonResult, readStringParam } from "branch/plugin-sdk/core";
import type { AnyAgentTool } from "branch/plugin-sdk/plugin-entry";
import { asNonArrayRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { Type } from "typebox";
import { redactClaimToken, redactDispatchResult } from "./card-redaction.js";
import type { CanopyStore } from "./store.js";
import {
  cardIdField,
  createCanopyCardMutations,
  requireScopedCard,
  claimTokenField,
  strictObject,
  workspaceField,
} from "./tools-card-mutations.js";

const CardIdSchema = strictObject({
  id: cardIdField(),
  token: claimTokenField(),
});
const ScopedClaimTokenField = claimTokenField("Claim token for claimed cards.");
const OptionalNextStatusField = Type.Optional(
  Type.String({ description: "Optional next status." }),
);
const OptionalOperatorNoteField = Type.Optional(
  Type.String({ description: "Optional operator note." }),
);

export function createCanopyOrchestrationTools(params: {
  store: CanopyStore;
  ownerId: string;
}): AnyAgentTool[] {
  const { store, ownerId } = params;
  const { scopedCardMutation, claimedCardMutation } = createCanopyCardMutations(store, ownerId);
  return [
    {
      name: "canopy_boards",
      label: "Canopy Boards",
      description: "List Canopy board namespaces with active, archived, and status counts.",
      parameters: strictObject({}),
      execute: async () => jsonResult(await store.listBoards()),
    },
    {
      name: "canopy_board_create",
      label: "Canopy Board Create",
      description:
        "Create or update a Canopy board with persisted SQLite metadata. Choose kind sessions on creation for utility-model categorized sessions with free-form columns; card tools do not apply to Sessions boards. Board kind cannot change after creation.",
      parameters: strictObject({
        id: Type.String({ description: "Board id." }),
        kind: Type.Optional(
          Type.Union([Type.Literal("cards"), Type.Literal("sessions")], {
            description: "Board kind, set only at creation. Default cards.",
          }),
        ),
        name: Type.Optional(Type.String({ description: "Display name." })),
        description: Type.Optional(Type.String({ description: "Board description." })),
        icon: Type.Optional(Type.String({ description: "Short icon or label." })),
        color: Type.Optional(Type.String({ description: "Display color token." })),
        automationJobId: Type.Optional(
          Type.String({
            description: "Owning automation job id.",
            minLength: 1,
            maxLength: 128,
          }),
        ),
        defaultWorkspace: workspaceField(),
        orchestration: Type.Optional(
          strictObject({
            autoDecompose: Type.Optional(
              Type.Boolean({ description: "Mark ready triage cards for decomposition." }),
            ),
            autoDecomposePerDispatch: Type.Optional(
              Type.Number({ description: "Maximum orchestration candidates per dispatch." }),
            ),
            defaultAssignee: Type.Optional(Type.String({ description: "Default assignee." })),
            orchestratorProfile: Type.Optional(
              Type.String({ description: "Orchestrator profile id." }),
            ),
          }),
        ),
      }),
      execute: async (_toolCallId, rawParams) =>
        jsonResult({ board: await store.upsertBoard(asNonArrayRecord(rawParams)) }),
    },
    {
      name: "canopy_board_archive",
      label: "Canopy Board Archive",
      description: "Archive or restore persisted Canopy board metadata.",
      parameters: strictObject({
        id: Type.String({ description: "Board id." }),
        archived: Type.Optional(Type.Boolean({ description: "Archive when true." })),
      }),
      execute: async (_toolCallId, rawParams) => {
        const record = asNonArrayRecord(rawParams);
        return jsonResult({ board: await store.archiveBoard(record.id, record.archived) });
      },
    },
    {
      name: "canopy_board_delete",
      label: "Canopy Board Delete",
      description: "Delete an empty non-default Canopy board metadata record.",
      parameters: strictObject({ id: Type.String({ description: "Board id." }) }),
      execute: async (_toolCallId, rawParams) =>
        jsonResult(await store.deleteBoard(asNonArrayRecord(rawParams).id)),
    },
    {
      name: "canopy_stats",
      label: "Canopy Stats",
      description: "Summarize Canopy counts by status and assignee for one board or all boards.",
      parameters: strictObject({
        boardId: Type.Optional(Type.String({ description: "Optional board id filter." })),
      }),
      execute: async (_toolCallId, rawParams) => {
        const record = asNonArrayRecord(rawParams);
        return jsonResult(await store.stats({ boardId: record.boardId }));
      },
    },
    {
      name: "canopy_runs",
      label: "Canopy Runs",
      description: "List persisted Canopy run attempts for one card.",
      parameters: CardIdSchema,
      execute: async (_toolCallId, rawParams) => {
        const id = readStringParam(asNonArrayRecord(rawParams), "id", { required: true });
        const result = await store.runs(id);
        return jsonResult({ ...result, card: redactClaimToken(result.card) });
      },
    },
    {
      name: "canopy_specify",
      label: "Canopy Specify",
      description:
        "Turn a rough triage/backlog Canopy card into a specified todo card after reasoning through the requirements.",
      parameters: strictObject({
        id: Type.String({ description: "Canopy card id." }),
        title: Type.Optional(Type.String({ description: "Clarified title." })),
        notes: Type.Optional(
          Type.String({ description: "Clarified notes or acceptance criteria." }),
        ),
        agentId: Type.Optional(Type.String({ description: "Assigned agent id." })),
        priority: Type.Optional(Type.String({ description: "low, normal, high, or urgent." })),
        labels: Type.Optional(Type.Array(Type.String(), { description: "Card labels." })),
        boardId: Type.Optional(Type.String({ description: "Board id." })),
        tenant: Type.Optional(Type.String({ description: "Tenant or routing namespace." })),
        skills: Type.Optional(Type.Array(Type.String(), { description: "Suggested skills." })),
        workspace: workspaceField(),
        maxRuntimeSeconds: Type.Optional(Type.Number({ description: "Runtime budget." })),
        maxRetries: Type.Optional(Type.Number({ description: "Retry budget." })),
        summary: Type.Optional(Type.String({ description: "Specification summary comment." })),
        token: Type.Optional(Type.String({ description: "Claim token for claimed cards." })),
      }),
      execute: async (_toolCallId, rawParams) => {
        const record = asNonArrayRecord(rawParams);
        const id = readStringParam(record, "id", { required: true });
        const token = typeof record.token === "string" ? record.token : undefined;
        await requireScopedCard(store, id, ownerId, token);
        return jsonResult({
          card: redactClaimToken(await store.specify(id, record, { ownerId, token: record.token })),
        });
      },
    },
    {
      name: "canopy_decompose",
      label: "Canopy Decompose",
      description:
        "Fan out a Canopy card into linked child cards and optionally complete the parent orchestration card.",
      parameters: strictObject({
        id: Type.String({ description: "Parent Canopy card id." }),
        token: Type.Optional(Type.String({ description: "Claim token for claimed cards." })),
        summary: Type.Optional(Type.String({ description: "Decomposition summary." })),
        completeParent: Type.Optional(
          Type.Boolean({
            description: "Complete the parent after child creation. Default true.",
          }),
        ),
        children: Type.Array(
          strictObject({
            title: Type.String({ description: "Child title." }),
            notes: Type.Optional(Type.String({ description: "Child notes." })),
            agentId: Type.Optional(Type.String({ description: "Assigned agent id." })),
            priority: Type.Optional(Type.String({ description: "low, normal, high, or urgent." })),
            labels: Type.Optional(Type.Array(Type.String())),
            boardId: Type.Optional(Type.String()),
            tenant: Type.Optional(Type.String()),
            skills: Type.Optional(Type.Array(Type.String())),
            workspace: workspaceField(),
            maxRuntimeSeconds: Type.Optional(Type.Number()),
            maxRetries: Type.Optional(Type.Number()),
            idempotencyKey: Type.Optional(Type.String()),
          }),
        ),
      }),
      execute: async (_toolCallId, rawParams) => {
        const record = asNonArrayRecord(rawParams);
        const id = readStringParam(record, "id", { required: true });
        const token = typeof record.token === "string" ? record.token : undefined;
        await requireScopedCard(store, id, ownerId, token);
        const result = await store.decompose(id, record, { ownerId, token: record.token });
        return jsonResult({
          parent: redactClaimToken(result.parent),
          children: result.children.map(redactClaimToken),
        });
      },
    },
    {
      name: "canopy_notify_subscribe",
      label: "Canopy Notify Subscribe",
      description: "Persist a Canopy notification subscription in the plugin SQLite store.",
      parameters: strictObject({
        boardId: Type.Optional(Type.String({ description: "Board id. Default default." })),
        cardId: Type.Optional(Type.String({ description: "Card id." })),
        sessionKey: Type.Optional(Type.String({ description: "Session key." })),
        runId: Type.Optional(Type.String({ description: "Run id." })),
        target: Type.Optional(Type.String({ description: "Human-readable target." })),
        eventKinds: Type.Optional(
          Type.Array(Type.String(), { description: "completed, failed, stale." }),
        ),
      }),
      execute: async (_toolCallId, rawParams) =>
        jsonResult({
          subscription: await store.subscribeNotifications(asNonArrayRecord(rawParams)),
        }),
    },
    {
      name: "canopy_notify_list",
      label: "Canopy Notify List",
      description: "List persisted Canopy notification subscriptions.",
      parameters: strictObject({
        boardId: Type.Optional(Type.String({ description: "Board id." })),
        cardId: Type.Optional(Type.String({ description: "Card id." })),
      }),
      execute: async (_toolCallId, rawParams) =>
        jsonResult(await store.listNotificationSubscriptions(asNonArrayRecord(rawParams))),
    },
    {
      name: "canopy_notify_events",
      label: "Canopy Notify Events",
      description: "Read replay-safe Canopy notification events without advancing cursors.",
      parameters: strictObject({
        subscriptionId: Type.Optional(Type.String({ description: "Subscription id." })),
        boardId: Type.Optional(Type.String({ description: "Board id." })),
        cardId: Type.Optional(Type.String({ description: "Card id." })),
        limit: Type.Optional(Type.Number({ description: "Maximum events. Default 50." })),
      }),
      execute: async (_toolCallId, rawParams) =>
        jsonResult(await store.notificationEvents(asNonArrayRecord(rawParams))),
    },
    {
      name: "canopy_notify_advance",
      label: "Canopy Notify Advance",
      description: "Read Canopy notification events and advance the subscription cursor.",
      parameters: strictObject({
        subscriptionId: Type.String({ description: "Subscription id." }),
        limit: Type.Optional(Type.Number({ description: "Maximum events. Default 50." })),
      }),
      execute: async (_toolCallId, rawParams) =>
        jsonResult(await store.advanceNotificationEvents(asNonArrayRecord(rawParams))),
    },
    {
      name: "canopy_notify_unsubscribe",
      label: "Canopy Notify Unsubscribe",
      description: "Delete a persisted Canopy notification subscription.",
      parameters: strictObject({ id: Type.String({ description: "Subscription id." }) }),
      execute: async (_toolCallId, rawParams) => {
        const id = readStringParam(asNonArrayRecord(rawParams), "id", { required: true });
        return jsonResult(await store.deleteNotificationSubscription(id));
      },
    },
    {
      name: "canopy_promote",
      label: "Canopy Promote",
      description:
        "Promote a dependency-ready card into ready, optionally forcing past holds for operator recovery.",
      parameters: strictObject({
        id: cardIdField(),
        token: ScopedClaimTokenField,
        force: Type.Optional(Type.Boolean({ description: "Bypass dependency or schedule holds." })),
        reason: OptionalOperatorNoteField,
      }),
      execute: scopedCardMutation((id, record, scope) => store.promote(id, record, scope)),
    },
    {
      name: "canopy_reassign",
      label: "Canopy Reassign",
      description: "Change a card assignee and optionally reset failure state during recovery.",
      parameters: strictObject({
        id: cardIdField(),
        token: ScopedClaimTokenField,
        agentId: Type.Optional(Type.String({ description: "New assignee id." })),
        status: OptionalNextStatusField,
        resetFailures: Type.Optional(Type.Boolean({ description: "Reset failure count." })),
        reason: OptionalOperatorNoteField,
      }),
      execute: scopedCardMutation((id, record, scope) => store.reassign(id, record, scope)),
    },
    {
      name: "canopy_reclaim",
      label: "Canopy Reclaim",
      description:
        "Release a stale claim and stop running attempts so another agent can pick it up.",
      parameters: strictObject({
        id: cardIdField(),
        token: ScopedClaimTokenField,
        status: OptionalNextStatusField,
        reason: OptionalOperatorNoteField,
      }),
      execute: scopedCardMutation((id, record, scope) => store.reclaim(id, record, scope)),
    },
    {
      name: "canopy_dispatch",
      label: "Canopy Dispatch",
      description:
        "Advance persisted board state without launching workers: promote unblocked cards, reclaim expired claims, and block timed-out runs.",
      parameters: strictObject({
        boardId: Type.Optional(Type.String({ description: "Optional board id filter." })),
      }),
      execute: async (_toolCallId, rawParams) => {
        const record = asNonArrayRecord(rawParams);
        const result = await store.dispatch({ boardId: record.boardId });
        return jsonResult(redactDispatchResult(result));
      },
    },
    {
      name: "canopy_worker_log",
      label: "Canopy Worker Log",
      description: "Append a persisted worker log entry to a Canopy card.",
      parameters: strictObject({
        id: cardIdField(),
        level: Type.Optional(Type.String({ description: "info, warning, or error." })),
        message: Type.String({ description: "Worker log message." }),
        sessionKey: Type.Optional(Type.String({ description: "Linked session key." })),
        runId: Type.Optional(Type.String({ description: "Linked run id." })),
        token: ScopedClaimTokenField,
      }),
      execute: scopedCardMutation((id, record, scope) => store.addWorkerLog(id, record, scope)),
    },
    {
      name: "canopy_protocol_violation",
      label: "Canopy Protocol Violation",
      description:
        "Block a card and record a worker protocol violation when work stops without complete/block.",
      parameters: strictObject({
        id: cardIdField(),
        detail: Type.Optional(Type.String({ description: "Violation detail." })),
        sessionKey: Type.Optional(Type.String({ description: "Linked session key." })),
        runId: Type.Optional(Type.String({ description: "Linked run id." })),
        token: ScopedClaimTokenField,
      }),
      execute: claimedCardMutation((id, record, scope) =>
        store.recordProtocolViolation(id, record, scope),
      ),
    },
  ];
}
