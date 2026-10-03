import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  resolveConfiguredBindingRoute,
  resolveRuntimeConversationBindingRoute,
} from "branch/plugin-sdk/conversation-binding-runtime";
import type { ResolvedAgentRoute } from "branch/plugin-sdk/routing";
import { logVerbose } from "branch/plugin-sdk/runtime-env";
import { shouldIgnoreStaleDiscordRouteBinding } from "./route-resolution.js";

export function resolveDiscordConversationBindingRoute(params: {
  cfg: BranchConfig;
  resolveRoute: NonNullable<
    Parameters<typeof resolveRuntimeConversationBindingRoute>[0]["resolveRoute"]
  >;
  accountId: string;
  runtimeConversationId: string;
  configuredConversationId: string;
  parentConversationId?: string;
  touchBinding?: boolean;
}) {
  let baseRoute: ResolvedAgentRoute | undefined;
  let runtimeRoute = resolveRuntimeConversationBindingRoute({
    resolveRoute: (selection) => {
      baseRoute = params.resolveRoute(selection);
      return baseRoute;
    },
    touchBinding: params.touchBinding,
    conversation: {
      channel: "discord",
      accountId: params.accountId,
      conversationId: params.runtimeConversationId,
      parentConversationId: params.parentConversationId,
    },
  });
  const route = baseRoute ?? runtimeRoute.route;
  if (
    shouldIgnoreStaleDiscordRouteBinding({
      bindingRecord: runtimeRoute.bindingRecord,
      route,
    })
  ) {
    logVerbose(
      `discord: ignoring stale route binding for conversation ${params.runtimeConversationId} (${runtimeRoute.bindingRecord?.targetSessionKey} -> ${route.sessionKey})`,
    );
    runtimeRoute = {
      bindingOwnerAvailable: true,
      bindingRecord: null,
      route: { ...runtimeRoute.route, ...route },
    };
  }
  const configuredRoute = runtimeRoute.bindingRecord
    ? null
    : resolveConfiguredBindingRoute({
        cfg: params.cfg,
        route: runtimeRoute.route,
        conversation: {
          channel: "discord",
          accountId: params.accountId,
          conversationId: params.configuredConversationId,
          parentConversationId: params.parentConversationId,
        },
      });
  return { runtimeRoute, configuredRoute };
}
