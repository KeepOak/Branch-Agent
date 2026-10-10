import {
  ErrorCodes,
  errorShape,
  validateModelsAuthPauseSetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { setAuthProfilePaused } from "../../agents/auth-profiles.js";
import { resolveProviderIdForAuth } from "../../agents/provider-auth-aliases.js";
import { refreshModelAuthStateAfterMutation } from "../model-auth-refresh.js";
import { readPreparedCatalog } from "../server-model-catalog-auth.js";
import { resolveModelAuthAgentScope } from "./model-auth-agent-scope.js";
import { respondUnavailableOnThrow } from "./response.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

type PauseParams = {
  provider: string;
  profileId: string;
  paused: boolean;
  until?: number;
  agentId?: string;
};

/** A pause ends in the future or it is refused: a past end time would silently do nothing. */
function pauseEndProblem(params: PauseParams, now: number): string | undefined {
  if (!params.paused || params.until === undefined) {
    return undefined;
  }
  return params.until > now ? undefined : "The pause end time must be in the future.";
}

export const modelsAuthPauseHandlers: GatewayRequestHandlers = {
  "models.authPauseSet": async ({ params, respond, context }) => {
    if (
      !assertValidParams(params, validateModelsAuthPauseSetParams, "models.authPauseSet", respond)
    ) {
      return;
    }
    const pauseParams = params as PauseParams;
    const endProblem = pauseEndProblem(pauseParams, Date.now());
    if (endProblem) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, endProblem));
      return;
    }
    await respondUnavailableOnThrow(respond, async () => {
      const cfg = context.getRuntimeConfig();
      const scope = resolveModelAuthAgentScope(cfg, pauseParams.agentId);
      if (!scope.ok) {
        respond(false, undefined, scope.error);
        return;
      }
      const snapshot = await readPreparedCatalog(context, scope.agentId);
      if (!snapshot) {
        throw new Error(`prepared model auth owner is unavailable (${scope.agentId})`);
      }
      const lookup = {
        config: snapshot.config,
        workspaceDir: snapshot.workspaceDir,
        metadataSnapshot: snapshot.metadataSnapshot,
        includeUntrustedWorkspacePlugins: false,
      };
      const authProvider = resolveProviderIdForAuth(pauseParams.provider, lookup);
      const known = Object.entries(snapshot.authStore.profiles).some(
        ([profileId, credential]) =>
          profileId === pauseParams.profileId &&
          resolveProviderIdForAuth(credential.provider, { ...lookup, storedCredential: true }) ===
            authProvider,
      );
      if (!known) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `profileId ${pauseParams.profileId} is unavailable for provider ${pauseParams.provider}`,
          ),
        );
        return;
      }
      await setAuthProfilePaused({
        agentDir: snapshot.agentDir,
        profileId: pauseParams.profileId,
        paused: pauseParams.paused
          ? pauseParams.until === undefined
            ? {}
            : { until: pauseParams.until }
          : null,
      });
      await refreshModelAuthStateAfterMutation(context.getRuntimeConfig, scope.agentId);
      respond(
        true,
        {
          provider: pauseParams.provider,
          profileId: pauseParams.profileId,
          paused: pauseParams.paused,
        },
        undefined,
      );
    });
  },
};
