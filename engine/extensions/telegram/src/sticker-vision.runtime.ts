import {
  findModelInCatalog,
  loadPreparedModelCatalog,
  modelSupportsVision,
  resolveAgentDir,
  resolveDefaultModelForAgent,
} from "branch/plugin-sdk/agent-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export async function resolveStickerVisionSupportRuntime(params: {
  cfg: BranchConfig;
  agentId?: string;
}): Promise<boolean> {
  const catalog = await loadPreparedModelCatalog({
    config: params.cfg,
    ...(params.agentId
      ? {
          agentId: params.agentId,
          agentDir: resolveAgentDir(params.cfg, params.agentId),
        }
      : {}),
    readOnly: true,
  });
  const defaultModel = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const entry = findModelInCatalog(catalog, defaultModel.provider, defaultModel.model);
  if (!entry) {
    return false;
  }
  return modelSupportsVision(entry);
}
