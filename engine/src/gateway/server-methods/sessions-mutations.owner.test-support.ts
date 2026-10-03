import { vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { trackAsyncWork } from "../../shared/async-work-scope.js";
import type { GatewayClient, GatewayRequestContext } from "./types.js";

export function createSessionMutationTestClient(profileId?: string): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: {
        id: "branch-control-ui",
        version: "test",
        platform: "test",
        mode: "webchat",
      },
      role: "operator",
      scopes: ["operator.write"],
    },
    ...(profileId
      ? {
          authenticatedUserId: `${profileId}@example.com`,
          authenticatedUserProfile: {
            profileId,
            displayName: profileId,
            hasAvatar: false,
            updatedAt: 1,
          },
        }
      : {}),
  };
}

export function createSessionMutationTestContext(cfg: BranchConfig) {
  return {
    trackExecution: trackAsyncWork,
    getRuntimeConfig: () => cfg,
    getSessionEventSubscriberConnIds: () => new Set(["observer"]),
    broadcastToConnIds: vi.fn(),
    chatAbortControllers: new Map(),
  } as unknown as GatewayRequestContext;
}
