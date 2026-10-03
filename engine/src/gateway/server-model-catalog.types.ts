import type { ModelCatalogEntry, ModelCatalogSnapshot } from "../agents/model-catalog.types.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { ProviderThinkingRegistry } from "../plugins/provider-thinking.types.js";

/** Catalog entries and policy come from the same completed prepared generation. */
export type PreparedGatewayModelCatalog = {
  entries: ModelCatalogEntry[];
  routeVariants?: ModelCatalogEntry[];
  pluginRegistry?: ProviderThinkingRegistry;
};

export type PreparedGatewayModelCatalogReadResult = PromiseSettledResult<
  PreparedGatewayModelCatalog | undefined
>;

export type GatewayModelCatalogSnapshot = ModelCatalogSnapshot & {
  agentId: string;
  agentDir: string;
  catalogComplete: boolean;
  workspaceDir: string;
  config: BranchConfig;
};
