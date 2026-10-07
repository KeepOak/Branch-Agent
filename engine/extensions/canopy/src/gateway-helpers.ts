import { formatErrorMessage } from "branch/plugin-sdk/error-runtime";
import { ErrorCodes, errorShape } from "branch/plugin-sdk/gateway-runtime";
import { parseStrictPositiveInteger } from "branch/plugin-sdk/number-runtime";
import { asRecord, isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { BranchPluginApi } from "../api.js";
import { redactClaimToken, redactDispatchResult } from "./card-redaction.js";
import { dispatchAndStartCanopyCards } from "./dispatcher.js";
import { CanopyCardConflictError, type CanopyStore } from "./store.js";
import {
  resolveAgentCanopyWorkspaceRuntime,
  resolveConfiguredCanopyWorkspaceAccess,
  resolveCanopyAgentWorkspace,
  type CanopyWorkspaceAccess,
} from "./workspace-access.js";

export type GatewayMethodContext = Parameters<
  Parameters<BranchPluginApi["registerGatewayMethod"]>[1]
>[0];
type GatewayRespond = GatewayMethodContext["respond"];
type CanopyGatewayResultHandler = (context: GatewayMethodContext) => unknown;
type CanopyGatewayScope = NonNullable<
  NonNullable<Parameters<BranchPluginApi["registerGatewayMethod"]>[2]>["scope"]
>;

export class CanopyUploadsDisabledError extends Error {
  constructor() {
    super("File and image uploads are disabled by gateway.uploads.enabled");
    this.name = "CanopyUploadsDisabledError";
  }
}

export function respondError(respond: GatewayRespond, error: unknown) {
  if (error instanceof CanopyUploadsDisabledError) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.FORBIDDEN, error.message, { details: { code: "UPLOADS_DISABLED" } }),
    );
    return;
  }
  if (error instanceof CanopyCardConflictError) {
    respond(false, undefined, {
      code: "canopy_conflict",
      message: error.message,
      details: {
        type: "canopy_card_conflict",
        card: redactClaimToken(error.current),
      },
    });
    return;
  }
  respond(false, undefined, {
    code: "canopy_error",
    message: formatErrorMessage(error),
  });
}

export function registerCanopyResultMethods(
  api: BranchPluginApi,
  methods: ReadonlyArray<
    readonly [method: string, scope: CanopyGatewayScope, handler: CanopyGatewayResultHandler]
  >,
): void {
  for (const [method, scope, handler] of methods) {
    api.registerGatewayMethod(
      method,
      async (context) => {
        try {
          context.respond(true, await handler(context));
        } catch (error) {
          respondError(context.respond, error);
        }
      },
      { scope },
    );
  }
}

export function readExpectedUpdatedAt(params: Record<string, unknown>): number | undefined {
  const value = params.expectedUpdatedAt;
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("expectedUpdatedAt must be a finite number.");
  }
  return value;
}

export function readId(params: Record<string, unknown>): string {
  const value = params.id;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  throw new Error("id is required.");
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseStrictPositiveInteger(value);
  if (typeof value !== "number" || parsed === undefined) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

export function readPatch(params: Record<string, unknown>): Record<string, unknown> {
  return isRecord(params.patch) ? params.patch : params;
}

export function assertNoCursorAdvance(params: Record<string, unknown>) {
  if (params.advance === true) {
    throw new Error("notification cursor advancement requires canopy.notifications.advance.");
  }
}

export function resolveGatewayCanopyWorkspaceAccess(params: {
  context: GatewayMethodContext["context"];
  client: GatewayMethodContext["client"];
}): CanopyWorkspaceAccess {
  // In-process plugin dispatch has no remote client and already runs with host
  // authority. Connected write-scope clients stay within configured workspaces.
  if (!params.client) {
    return { unrestricted: true };
  }
  const scopes = Array.isArray(params.client?.connect?.scopes) ? params.client.connect.scopes : [];
  if (scopes.includes("operator.admin")) {
    return { unrestricted: true };
  }
  return resolveConfiguredCanopyWorkspaceAccess({
    config: params.context.getRuntimeConfig(),
    unrestricted: false,
  });
}

export function createCanopyDispatchHandler(params: {
  api: BranchPluginApi;
  store: CanopyStore;
}) {
  return async (
    { params: requestParams, respond, client, context }: GatewayMethodContext,
    options: { supportsMaxStarts: boolean; directCard?: boolean },
  ) => {
    try {
      const cardId = options.directCard ? readId(requestParams) : undefined;
      const { boardId, maxStarts: rawMaxStarts } = asRecord(requestParams);
      if (!options.supportsMaxStarts && rawMaxStarts !== undefined) {
        throw new Error("maxStarts requires canopy.cards.dispatchWithOptions.");
      }
      const maxStarts = options.supportsMaxStarts
        ? readOptionalPositiveInteger(rawMaxStarts, "maxStarts")
        : undefined;
      const provider =
        options.directCard &&
        typeof requestParams.provider === "string" &&
        requestParams.provider.trim()
          ? requestParams.provider.trim()
          : undefined;
      const model =
        options.directCard && typeof requestParams.model === "string" && requestParams.model.trim()
          ? requestParams.model.trim()
          : undefined;
      const result = await dispatchAndStartCanopyCards({
        store: params.store,
        subagent: params.api.runtime.subagent,
        worktrees: params.api.runtime.worktrees,
        options: {
          ...(cardId ? { cardId, maxStarts: 1 } : {}),
          boardId: typeof boardId === "string" ? boardId : undefined,
          ...(maxStarts !== undefined ? { maxStarts } : {}),
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          materializeWorktree: true,
          resolveAgentWorkspace: (agentId) =>
            resolveCanopyAgentWorkspace(context.getRuntimeConfig(), agentId),
          resolveAgentWorkspaceRuntime: (
            agentId,
            sessionKey,
            workspaceDir,
            modelProvider,
            modelId,
          ) => {
            const config = context.getRuntimeConfig();
            return resolveAgentCanopyWorkspaceRuntime({
              config,
              agentId,
              sessionKey,
              workspaceDir,
              modelProvider,
              modelId,
              prepareSandboxWorkspaceAuthority:
                params.api.runtime.sandbox.prepareWorkspaceAuthority,
            });
          },
          workspaceAccess: resolveGatewayCanopyWorkspaceAccess({ context, client }),
        },
      });
      if (cardId) {
        const started = result.started[0];
        if (!started?.card) {
          throw new Error(result.startFailures[0]?.error ?? "Canopy card did not start.");
        }
        respond(true, { ...started, card: redactClaimToken(started.card) });
        return;
      }
      respond(true, redactDispatchResult(result));
    } catch (error) {
      respondError(respond, error);
    }
  };
}
