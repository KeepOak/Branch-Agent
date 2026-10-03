import type { BranchConfig } from "../config/types.branch.js";
import { planBranchModelsJson, type PreparedModelsConfigContext } from "./models-config.plan.js";

type PreparedPlanParams = Parameters<typeof planBranchModelsJson>[0];
type FlatPreparedContext = Omit<
  PreparedModelsConfigContext,
  "discoveryAuthConfig" | "sourceConfigForSecrets" | "envFingerprint"
> & {
  discoveryAuthConfig?: BranchConfig;
  sourceConfigForSecrets?: BranchConfig;
};
type PlanParams = Omit<PreparedPlanParams, "context" | "existingRaw" | "existingParsed"> &
  FlatPreparedContext & {
    existingRaw?: string;
    existingParsed?: unknown;
  };

export function planModelsJsonForTest(params: PlanParams) {
  const {
    authStore,
    existingRaw = "",
    existingParsed = null,
    pluginCatalogs,
    ...contextParams
  } = params;
  return planBranchModelsJson({
    context: {
      ...contextParams,
      discoveryAuthConfig: params.discoveryAuthConfig ?? params.cfg,
      sourceConfigForSecrets: params.sourceConfigForSecrets ?? params.cfg,
      envFingerprint: params.env,
    },
    ...(authStore ? { authStore } : {}),
    existingRaw,
    existingParsed,
    ...(pluginCatalogs ? { pluginCatalogs } : {}),
  });
}
