import {
  ErrorCodes,
  errorShape,
  validateModelsAuthOrderSetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import {
  resolveExplicitAuthOrderSelection,
  setAuthProfileOrder,
} from "../../agents/auth-profiles.js";
import { SUBSCRIPTION_ONLY_SIGN_IN_MESSAGE } from "../../agents/auth-profiles/subscription-only.js";
import { resolveProviderIdForAuth } from "../../agents/provider-auth-aliases.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { refreshModelAuthStateAfterMutation } from "../model-auth-refresh.js";
import { readPreparedCatalog } from "../server-model-catalog-auth.js";
import {
  isAgentSessionModelPatchOrigin,
  isSessionStatusModelPatchOrigin,
} from "../session-model-patch-origin.js";
import { formatForLog } from "../ws-log.js";
import { resolveModelAuthAgentScope } from "./model-auth-agent-scope.js";
import { resolveConfigBoundProfileIds } from "./models-auth-status-config.js";
import type { ModelAuthOrderSetResult } from "./models-auth-status.types.js";
import { respondUnavailableOnThrow } from "./response.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

const log = createSubsystemLogger("models-auth-order");

export const modelsAuthOrderHandlers: GatewayRequestHandlers = {
  "models.authOrderSet": async ({ params, respond, context, client }) => {
    if (
      !assertValidParams(params, validateModelsAuthOrderSetParams, "models.authOrderSet", respond)
    ) {
      return;
    }
    const provider = params.provider;
    const profileIds = params.profileIds ?? null;
    const rejectInvalidOrder = (message: string) =>
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    await respondUnavailableOnThrow(respond, async () => {
      const cfg = context.getRuntimeConfig();
      const scope = resolveModelAuthAgentScope(cfg, params.agentId);
      if (!scope.ok) {
        respond(false, undefined, scope.error);
        return;
      }
      const preparedSnapshot = await readPreparedCatalog(context, scope.agentId);
      if (!preparedSnapshot) {
        throw new Error(`prepared model auth owner is unavailable (${scope.agentId})`);
      }
      const authAliasLookupParams = {
        config: preparedSnapshot.config,
        workspaceDir: preparedSnapshot.workspaceDir,
        metadataSnapshot: preparedSnapshot.metadataSnapshot,
        includeUntrustedWorkspacePlugins: false,
      };
      const authProvider = resolveProviderIdForAuth(provider, authAliasLookupParams);
      const configuredOrder = resolveExplicitAuthOrderSelection({
        storeOrder: preparedSnapshot.authStore.order,
        configuredOrder: preparedSnapshot.config.auth?.order,
        providerKey: provider,
        providerAuthKey: authProvider,
      });
      if (profileIds && configuredOrder.order !== undefined && !configuredOrder.fromStore) {
        rejectInvalidOrder(
          `profile priority for provider ${provider} is controlled by auth configuration`,
        );
        return;
      }
      const availableProfileIds = Object.entries(preparedSnapshot.authStore.profiles)
        .filter(
          ([, credential]) =>
            resolveProviderIdForAuth(credential.provider, {
              ...authAliasLookupParams,
              storedCredential: true,
            }) === authProvider,
        )
        .map(([profileId]) => profileId);
      const configBoundProfileIds = resolveConfigBoundProfileIds(
        preparedSnapshot.config,
        preparedSnapshot.authStore,
        authAliasLookupParams,
      );
      if (
        profileIds &&
        availableProfileIds.some((profileId) => configBoundProfileIds.has(profileId))
      ) {
        rejectInvalidOrder(
          `profile priority for provider ${provider} is controlled by provider configuration`,
        );
        return;
      }
      const invalidProfile = profileIds?.find(
        (profileId) => !availableProfileIds.includes(profileId),
      );
      if (invalidProfile) {
        rejectInvalidOrder(`profileId ${invalidProfile} is unavailable for provider ${provider}`);
        return;
      }
      // Agent-made order changes never put an API-key sign-in in line; owner changes stay as-is.
      const agentMade =
        client?.internal?.agentRuntimeIdentity !== undefined ||
        isAgentSessionModelPatchOrigin() ||
        isSessionStatusModelPatchOrigin();
      if (
        agentMade &&
        profileIds?.some(
          (profileId) => preparedSnapshot.authStore.profiles[profileId]?.type === "api_key",
        )
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.FORBIDDEN, SUBSCRIPTION_ONLY_SIGN_IN_MESSAGE),
        );
        return;
      }
      const updated = await setAuthProfileOrder({
        agentDir: preparedSnapshot.agentDir,
        provider: authProvider,
        order: profileIds,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "auth profile order is temporarily unavailable"),
        );
        return;
      }
      const result: ModelAuthOrderSetResult = { provider, profileIds };
      // The store already started auth publication. Await that owner so immediate status
      // is current, but do not report a committed write as failed if publication rejects.
      try {
        await refreshModelAuthStateAfterMutation(context.getRuntimeConfig, scope.agentId);
      } catch (err) {
        log.warn(`auth profile order saved but runtime publication failed: ${formatForLog(err)}`);
        result.warning =
          "Profile priority saved. Live status is unavailable; refresh Models or restart the Gateway.";
      }
      respond(true, result, undefined);
    });
  },
};
