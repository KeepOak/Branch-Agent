import type { CanopyCard, CanopySessionsBoardView } from "@branch/canopy-contract";
import { readStringParam } from "branch/plugin-sdk/core";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { BranchPluginApi } from "../api.js";
import { redactClaimToken } from "./card-redaction.js";
import {
  assertNoCursorAdvance,
  createCanopyDispatchHandler,
  listCanopyCards,
  readId,
  readExpectedUpdatedAt,
  registerCanopyResultMethods,
  respondError,
  CanopyUploadsDisabledError,
  type GatewayMethodContext,
} from "./gateway-helpers.js";
import {
  registerCanopyWorkspaceBoardMethod,
  registerCanopyWorkspaceBulkMethod,
  registerCanopyWorkspaceCardMethods,
  registerCanopyWorkspaceWorkflowMethods,
} from "./gateway-workspace-methods.js";
import type { CanopySessionsBoardService } from "./sessions-board.js";
import { resolveCanopySqliteWorkerModuleUrl } from "./sqlite-store-paths.js";
import { registerCanopyStoreLifecycle } from "./store-lifecycle.js";
import { CanopyStore } from "./store.js";

const READ_SCOPE = "operator.read" as const;
const WRITE_SCOPE = "operator.write" as const;

function sessionsBoardView(input: Record<string, unknown>): CanopySessionsBoardView | undefined {
  const unknownParam = Object.keys(input).find((key) => key !== "boardId" && key !== "view");
  if (unknownParam) {
    throw new Error(`Unknown Sessions board read field: ${unknownParam}.`);
  }
  if (input.view === undefined) {
    return undefined;
  }
  if (!isRecord(input.view)) {
    throw new Error("view must be an object.");
  }
  const view: CanopySessionsBoardView = {};
  for (const [key, value] of Object.entries(input.view)) {
    switch (key) {
      case "involvingMe":
      case "includePeople":
        if (typeof value !== "boolean") {
          throw new Error(`view.${key} must be a boolean.`);
        }
        view[key] = value;
        break;
      case "involvingProfileId":
        if (typeof value !== "string") {
          throw new Error("view.involvingProfileId must be a string.");
        }
        view.involvingProfileId = value;
        break;
      default:
        throw new Error(`Unknown Sessions board view field: ${key}.`);
    }
  }
  return view;
}

/**
 * Interactive Sessions-board writes wait in the store's mutation queue, so the
 * caller's full Gateway authority (transport, role/scope/profile authorization,
 * in-process lifetime) is rechecked immediately before the SQLite write.
 */
function sessionsBoardCaller(
  context: Pick<
    GatewayMethodContext,
    | "hasCurrentClientAuthority"
    | "sessionMutationAuthorization"
    | "sessionAccessAuthority"
    | "sessionMutationCommitGuard"
    | "signal"
  >,
) {
  return {
    assertCurrent() {
      context.signal?.throwIfAborted();
      if (context.hasCurrentClientAuthority?.() === false) {
        throw new Error("Caller authority is no longer active.");
      }
      context.sessionAccessAuthority?.assertCurrent();
      context.sessionMutationAuthorization?.assertCurrent();
      context.sessionMutationCommitGuard?.();
    },
  };
}

function redactDiagnosticsRows(result: Awaited<ReturnType<CanopyStore["diagnostics"]>>) {
  return {
    ...result,
    diagnostics: result.diagnostics.map((row) => ({
      ...row,
      card: redactClaimToken(row.card),
    })),
  };
}

async function redactCardResult(card: Promise<CanopyCard>) {
  return { card: redactClaimToken(await card) };
}

function cardMutation(
  method: string,
  mutate: (id: string, input: Record<string, unknown>) => Promise<CanopyCard>,
) {
  return [
    `canopy.cards.${method}`,
    WRITE_SCOPE,
    ({ params }: GatewayMethodContext) => redactCardResult(mutate(readId(params), params)),
  ] as const;
}

export function registerCanopyGatewayMethods(params: {
  api: BranchPluginApi;
  store?: CanopyStore;
  sessionsBoard?: Pick<CanopySessionsBoardService, "read" | "update" | "move" | "refresh">;
}) {
  const { api: hostApi } = params;
  const assertUploadsAllowed = (client: GatewayMethodContext["client"]) => {
    if (
      !client?.internal?.syntheticClient &&
      !client?.internal?.agentRuntimeIdentity &&
      hostApi.runtime.config.current().gateway?.uploads?.enabled === false
    ) {
      throw new CanopyUploadsDisabledError();
    }
  };
  const store =
    params.store ??
    CanopyStore.openSqlite(resolveCanopySqliteWorkerModuleUrl(hostApi.runtimeSource));
  if (!params.store) {
    registerCanopyStoreLifecycle(hostApi, store);
  }
  const api: BranchPluginApi = {
    ...hostApi,
    registerGatewayMethod: (method, handler, options) =>
      hostApi.registerGatewayMethod(
        method,
        async (request) => {
          try {
            return await store.runOperation(() => {
              if (method === "canopy.cards.attachments.add") {
                assertUploadsAllowed(request.client);
              }
              return handler(request);
            });
          } catch (error) {
            respondError(request.respond, error);
          }
        },
        options,
      ),
  };
  const dispatchCards = createCanopyDispatchHandler({
    api,
    store,
  });

  registerCanopyResultMethods(api, [
    [
      "canopy.cards.list",
      READ_SCOPE,
      async ({ params: requestParams }) => await listCanopyCards(store, requestParams.boardId),
    ],
  ]);

  registerCanopyWorkspaceCardMethods({ api, store });

  api.registerGatewayMethod(
    "canopy.cards.start",
    async (context) => await dispatchCards(context, { supportsMaxStarts: false, directCard: true }),
    { scope: WRITE_SCOPE },
  );

  registerCanopyResultMethods(api, [
    [
      "canopy.cards.move",
      WRITE_SCOPE,
      ({ params: requestParams }) =>
        redactCardResult(
          store.move(
            readId(requestParams),
            requestParams.status,
            requestParams.position,
            undefined,
            {
              expectedUpdatedAt: readExpectedUpdatedAt(requestParams),
            },
          ),
        ),
    ],
    [
      "canopy.cards.delete",
      WRITE_SCOPE,
      ({ params: requestParams }) =>
        store.delete(readId(requestParams), {
          expectedUpdatedAt: readExpectedUpdatedAt(requestParams),
        }),
    ],
    cardMutation("comment", (id, input) => store.addComment(id, input)),
    cardMutation("link", (id, input) => store.addLink(id, input)),
    [
      "canopy.cards.linkDependency",
      WRITE_SCOPE,
      ({ params: requestParams }) => {
        const parentId = requestParams.parentId;
        const childId = requestParams.childId;
        if (typeof parentId !== "string" || typeof childId !== "string") {
          throw new Error("parentId and childId are required.");
        }
        return redactCardResult(store.linkCards(parentId, childId));
      },
    ],
    cardMutation("proof", (id, input) => store.addProof(id, input)),
    cardMutation("artifact", (id, input) => store.addArtifact(id, input)),
    [
      "canopy.cards.claim",
      WRITE_SCOPE,
      async ({ params: requestParams }) => {
        const claimed = await store.claim(readId(requestParams), requestParams);
        return { ...claimed, card: redactClaimToken(claimed.card) };
      },
    ],
    cardMutation("heartbeat", (id, input) => store.heartbeat(id, input)),
    cardMutation("release", (id, input) => store.releaseClaim(id, input)),
    cardMutation("promote", (id, input) => store.promote(id, input, null)),
    cardMutation("reassign", (id, input) => store.reassign(id, input, null)),
    cardMutation("reclaim", (id, input) => store.reclaim(id, input, null)),
    cardMutation("complete", (id, input) => store.complete(id, input, null)),
    cardMutation("block", (id, input) => store.block(id, input, null)),
    cardMutation("unblock", (id) => store.unblock(id)),
  ]);

  registerCanopyWorkspaceBulkMethod({ api, store });

  registerCanopyResultMethods(api, [
    [
      "canopy.cards.diagnostics",
      READ_SCOPE,
      async () => redactDiagnosticsRows(await store.diagnostics()),
    ],
    [
      "canopy.cards.diagnostics.refresh",
      WRITE_SCOPE,
      async () => redactDiagnosticsRows(await store.refreshDiagnostics()),
    ],
  ]);

  api.registerGatewayMethod(
    "canopy.cards.dispatch",
    async (context) => await dispatchCards(context, { supportsMaxStarts: false }),
    { scope: WRITE_SCOPE },
  );

  api.registerGatewayMethod(
    "canopy.cards.dispatchWithOptions",
    async (context) => await dispatchCards(context, { supportsMaxStarts: true }),
    { scope: WRITE_SCOPE },
  );

  registerCanopyResultMethods(api, [
    ["canopy.boards.list", READ_SCOPE, () => store.listBoards()],
  ]);

  registerCanopyWorkspaceBoardMethod({ api, store });

  const sessionsBoard = () => {
    if (!params.sessionsBoard) {
      throw new Error("Sessions board service is unavailable.");
    }
    return params.sessionsBoard;
  };
  registerCanopyResultMethods(api, [
    [
      "canopy.sessionsBoard.read",
      READ_SCOPE,
      ({ params: input }) =>
        sessionsBoard().read(
          readStringParam(input, "boardId", { required: true }),
          sessionsBoardView(input),
        ),
    ],
    [
      "canopy.sessionsBoard.update",
      WRITE_SCOPE,
      async (context: GatewayMethodContext) => {
        const input = context.params;
        const boardId = readStringParam(input, "boardId", { required: true });
        if (!isRecord(input.patch)) {
          throw new Error("patch must be an object.");
        }
        return {
          board: await sessionsBoard().update(boardId, input.patch, sessionsBoardCaller(context)),
        };
      },
    ],
    [
      "canopy.sessionsBoard.move",
      WRITE_SCOPE,
      (context: GatewayMethodContext) =>
        sessionsBoard().move(
          readStringParam(context.params, "boardId", { required: true }),
          readStringParam(context.params, "sessionKey", { required: true }),
          readStringParam(context.params, "columnId", { required: true }),
          sessionsBoardCaller(context),
        ),
    ],
    [
      "canopy.sessionsBoard.refresh",
      WRITE_SCOPE,
      (context: GatewayMethodContext) =>
        sessionsBoard().refresh(
          readStringParam(context.params, "boardId", { required: true }),
          sessionsBoardCaller(context),
        ),
    ],
  ]);

  registerCanopyResultMethods(api, [
    [
      "canopy.boards.archive",
      WRITE_SCOPE,
      async ({ params: requestParams }) => ({
        board: await store.archiveBoard(requestParams.id, requestParams.archived),
      }),
    ],
    [
      "canopy.boards.delete",
      WRITE_SCOPE,
      ({ params: requestParams }) => store.deleteBoard(requestParams.id),
    ],
    [
      "canopy.cards.stats",
      READ_SCOPE,
      ({ params: requestParams }) => store.stats({ boardId: requestParams.boardId }),
    ],
    [
      "canopy.cards.runs",
      READ_SCOPE,
      async ({ params: requestParams }) => {
        const result = await store.runs(readId(requestParams));
        return { ...result, card: redactClaimToken(result.card) };
      },
    ],
  ]);

  registerCanopyWorkspaceWorkflowMethods({ api, store });

  registerCanopyResultMethods(api, [
    [
      "canopy.notifications.subscribe",
      WRITE_SCOPE,
      async ({ params: requestParams }) => ({
        subscription: await store.subscribeNotifications(requestParams),
      }),
    ],
    [
      "canopy.notifications.list",
      READ_SCOPE,
      ({ params: requestParams }) => store.listNotificationSubscriptions(requestParams),
    ],
    [
      "canopy.notifications.delete",
      WRITE_SCOPE,
      ({ params: requestParams }) => store.deleteNotificationSubscription(readId(requestParams)),
    ],
    [
      "canopy.notifications.events",
      READ_SCOPE,
      ({ params: requestParams }) => {
        assertNoCursorAdvance(requestParams);
        return store.notificationEvents(requestParams);
      },
    ],
    [
      "canopy.notifications.advance",
      WRITE_SCOPE,
      ({ params: requestParams }) => store.advanceNotificationEvents(requestParams),
    ],
    [
      "canopy.cards.attachments.list",
      READ_SCOPE,
      async ({ params: requestParams }) => {
        const result = await store.listAttachments(readId(requestParams));
        return { ...result, card: redactClaimToken(result.card) };
      },
    ],
    [
      "canopy.cards.attachments.get",
      READ_SCOPE,
      async ({ params: requestParams }) => {
        const attachment = await store.getAttachment(readId(requestParams));
        if (!attachment) {
          throw new Error(`attachment not found: ${readId(requestParams)}`);
        }
        return attachment;
      },
    ],
    [
      "canopy.cards.attachments.add",
      WRITE_SCOPE,
      ({ params: input, client }: GatewayMethodContext) =>
        redactCardResult(
          store.addAttachment(readId(input), input, undefined, () => assertUploadsAllowed(client)),
        ),
    ],
    [
      "canopy.cards.attachments.delete",
      WRITE_SCOPE,
      ({ params: requestParams }) => {
        const attachmentId = requestParams.attachmentId;
        if (typeof attachmentId !== "string" || !attachmentId.trim()) {
          throw new Error("attachmentId is required.");
        }
        return redactCardResult(store.deleteAttachment(readId(requestParams), attachmentId.trim()));
      },
    ],
    cardMutation("workerLog", (id, input) => store.addWorkerLog(id, input)),
    cardMutation("protocolViolation", (id, input) => store.recordProtocolViolation(id, input)),
    [
      "canopy.cards.archive",
      WRITE_SCOPE,
      ({ params: requestParams }) =>
        redactCardResult(
          store.archive(readId(requestParams), requestParams.archived, {
            expectedUpdatedAt: readExpectedUpdatedAt(requestParams),
          }),
        ),
    ],
    [
      "canopy.cards.export",
      READ_SCOPE,
      async () => {
        const exported = await store.exportCards();
        return { ...exported, cards: exported.cards.map(redactClaimToken) };
      },
    ],
  ]);
}
