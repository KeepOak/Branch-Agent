import { resolveSessionModelRef } from "../../agents/session-model-ref.js";
import type { GatewayRequestContext } from "./types.js";

export type ModelReadiness = { model: string; ready: boolean; message?: string };

/** Uses the same account-aware, prepared projection as the picker; never starts discovery. */
export async function readAgentModelReadiness(
  context: Pick<GatewayRequestContext, "getRuntimeConfig" | "readPreparedModelsList">,
  agentId: string,
): Promise<ModelReadiness | undefined> {
  if (!context.readPreparedModelsList) {
    return undefined;
  }
  const configured = resolveSessionModelRef(context.getRuntimeConfig(), undefined, agentId);
  const model = `${configured.provider}/${configured.model}`;
  const catalog = await context.readPreparedModelsList({ agentId, params: { agentId } });
  if (!catalog) {
    return {
      model,
      ready: false,
      message: `Model access for ${model} has not been checked yet. Queue pickup is paused.`,
    };
  }
  const ready = catalog.models.some(
    (row) =>
      row.provider === configured.provider && row.id === configured.model && row.available === true,
  );
  return ready
    ? { model, ready }
    : {
        model,
        ready,
        message: `No available account can run ${model}. Choose another model or sign in with an account that supports it; queue pickup is paused.`,
      };
}
