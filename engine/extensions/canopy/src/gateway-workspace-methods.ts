import type { BranchPluginApi } from "../api.js";
import { redactClaimToken } from "./card-redaction.js";
import {
  readId,
  readExpectedUpdatedAt,
  readPatch,
  registerCanopyResultMethods,
  resolveGatewayCanopyWorkspaceAccess,
  type GatewayMethodContext,
} from "./gateway-helpers.js";
import type { CanopyStore } from "./store.js";
import {
  assertCanopyWorkspaceMutationAccess,
  canonicalizeCanopyWorkspaceAccess,
  containsCanopyWorkspaceMutation,
  withCanopyDecomposeWorkspaceAccess,
  withCanopyWorkspaceAccess,
  withoutCanopyWorkspaceAccess,
  type CanopyWorkspaceAccess,
} from "./workspace-access.js";

const WRITE_SCOPE = "operator.write" as const;

async function resolveGatewayWorkspaceMutationAccess(
  request: GatewayMethodContext,
  value: unknown,
): Promise<CanopyWorkspaceAccess> {
  const access = await canonicalizeCanopyWorkspaceAccess(
    resolveGatewayCanopyWorkspaceAccess({
      context: request.context,
      client: request.client,
    }),
  );
  await assertCanopyWorkspaceMutationAccess(value, access);
  return access;
}

type WorkspaceGatewayMethodParams = {
  api: BranchPluginApi;
  store: CanopyStore;
};

export function registerCanopyWorkspaceCardMethods(params: WorkspaceGatewayMethodParams): void {
  const { api, store } = params;
  registerCanopyResultMethods(api, [
    [
      "canopy.cards.create",
      WRITE_SCOPE,
      async (request) => {
        const input = withoutCanopyWorkspaceAccess(request.params);
        const access = await resolveGatewayWorkspaceMutationAccess(request, input);
        return {
          card: redactClaimToken(await store.create(withCanopyWorkspaceAccess(input, access))),
        };
      },
    ],
    [
      "canopy.cards.captureSession",
      WRITE_SCOPE,
      async (request) => {
        const input = withoutCanopyWorkspaceAccess(request.params);
        const access = await resolveGatewayWorkspaceMutationAccess(request, input);
        return {
          card: redactClaimToken(
            await store.captureSession(withCanopyWorkspaceAccess(input, access)),
          ),
        };
      },
    ],
    [
      "canopy.cards.update",
      WRITE_SCOPE,
      async (request) => {
        const { params: requestParams } = request;
        const patch = withoutCanopyWorkspaceAccess(readPatch(requestParams));
        const access = await resolveGatewayWorkspaceMutationAccess(request, patch);
        const expectedUpdatedAt = readExpectedUpdatedAt(requestParams);
        return {
          card: redactClaimToken(
            await store.update(
              readId(requestParams),
              containsCanopyWorkspaceMutation(patch)
                ? withCanopyWorkspaceAccess(patch, access)
                : patch,
              { expectedUpdatedAt },
            ),
          ),
        };
      },
    ],
  ]);
}

export function registerCanopyWorkspaceBulkMethod(params: WorkspaceGatewayMethodParams): void {
  const { api, store } = params;
  registerCanopyResultMethods(api, [
    [
      "canopy.cards.bulk",
      WRITE_SCOPE,
      async (request) => {
        const { params: requestParams } = request;
        const sanitizedParams = withoutCanopyWorkspaceAccess(requestParams);
        const patch = withoutCanopyWorkspaceAccess(readPatch(requestParams));
        const access = await resolveGatewayWorkspaceMutationAccess(request, patch);
        const result = await store.bulkUpdate({
          ...sanitizedParams,
          patch: containsCanopyWorkspaceMutation(patch)
            ? withCanopyWorkspaceAccess(patch, access)
            : patch,
        });
        return { cards: result.cards.map(redactClaimToken) };
      },
    ],
  ]);
}

export function registerCanopyWorkspaceBoardMethod(params: WorkspaceGatewayMethodParams): void {
  const { api, store } = params;
  registerCanopyResultMethods(api, [
    [
      "canopy.boards.upsert",
      WRITE_SCOPE,
      async (request) => {
        const { params: requestParams } = request;
        await resolveGatewayWorkspaceMutationAccess(request, requestParams);
        return { board: await store.upsertBoard(requestParams) };
      },
    ],
  ]);
}

export function registerCanopyWorkspaceWorkflowMethods(
  params: WorkspaceGatewayMethodParams,
): void {
  const { api, store } = params;
  registerCanopyResultMethods(api, [
    [
      "canopy.cards.specify",
      WRITE_SCOPE,
      async (request) => {
        const { params: requestParams } = request;
        const sanitizedParams = withoutCanopyWorkspaceAccess(requestParams);
        const access = await resolveGatewayWorkspaceMutationAccess(request, sanitizedParams);
        const input = containsCanopyWorkspaceMutation(sanitizedParams)
          ? withCanopyWorkspaceAccess(sanitizedParams, access)
          : sanitizedParams;
        return {
          card: redactClaimToken(await store.specify(readId(requestParams), input, null)),
        };
      },
    ],
    [
      "canopy.cards.decompose",
      WRITE_SCOPE,
      async (request) => {
        const { params: requestParams } = request;
        const sanitizedParams = withoutCanopyWorkspaceAccess(requestParams);
        const access = await resolveGatewayWorkspaceMutationAccess(request, sanitizedParams);
        const result = await store.decompose(
          readId(requestParams),
          withCanopyDecomposeWorkspaceAccess(sanitizedParams, access),
          null,
        );
        return {
          parent: redactClaimToken(result.parent),
          children: result.children.map(redactClaimToken),
        };
      },
    ],
  ]);
}
