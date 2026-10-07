import { listAgentIds, resolveAgentDir } from "branch/plugin-sdk/agent-scope-runtime";
import { ErrorCodes, errorShape } from "branch/plugin-sdk/gateway-runtime";
import type { GatewayRequestHandlerOptions } from "branch/plugin-sdk/gateway-runtime";
import { z } from "zod";
import { listAllCodexAppServerModels } from "./app-server/models.js";
import { requestOptions } from "./command-rpc.js";

const paramsSchema = z
  .object({ agentId: z.string().min(1), profileId: z.string().min(1).optional() })
  .strict();

export async function handleCodexAccountModels({
  params,
  respond,
  context,
}: GatewayRequestHandlerOptions): Promise<void> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Expected agentId."));
    return;
  }
  const { agentId, profileId } = parsed.data;
  const config = context.getRuntimeConfig();
  if (!listAgentIds(config).includes(agentId)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Unknown agent."));
    return;
  }
  try {
    const agentDir = resolveAgentDir(config, agentId);
    const result = await listAllCodexAppServerModels({
      ...requestOptions(config.plugins?.entries?.codex?.config, 100, config, agentDir),
      ...(profileId ? { authProfileId: profileId } : {}),
      authRequirement: "subscription",
      sharedClient: true,
    });
    respond(true, {
      models: result.models.map(({ id, model, displayName, hidden }) => ({
        id,
        model,
        ...(displayName ? { displayName } : {}),
        ...(hidden ? { hidden } : {}),
      })),
    });
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.UNAVAILABLE,
        error instanceof Error ? error.message : "Codex models are unavailable.",
      ),
    );
  }
}
