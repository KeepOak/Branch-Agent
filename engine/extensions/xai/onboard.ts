import {
  applyAgentDefaultModelPrimary,
  applyOnboardAuthAgentModelsAndProviders,
  createModelCatalogPresetAppliers,
  resolveAgentModelPrimaryValue,
  withAgentModelAliases,
  type ModelProviderConfig,
  type BranchConfig,
} from "branch/plugin-sdk/provider-onboard";
import {
  buildXaiCatalogModels,
  isLegacyXaiBuiltinModel,
  XAI_BASE_URL,
  XAI_DEFAULT_MODEL_ID,
} from "./model-definitions.js";

export const XAI_DEFAULT_MODEL_REF = `xai/${XAI_DEFAULT_MODEL_ID}`;

const xaiPresetAppliers = createModelCatalogPresetAppliers({
  primaryModelRef: XAI_DEFAULT_MODEL_REF,
  resolveParams: (cfg) => ({
    providerId: "xai",
    api: "openai-responses",
    baseUrl: XAI_BASE_URL,
    catalogModels: cfg.models?.mode === "replace" ? buildXaiCatalogModels() : [],
    aliases: [{ modelRef: XAI_DEFAULT_MODEL_REF, alias: "Grok" }],
  }),
});

function pruneRetiredXaiBuiltinModels(cfg: BranchConfig): BranchConfig {
  const provider = cfg.models?.providers?.xai;
  if (!provider || !Array.isArray(provider.models)) {
    return cfg;
  }
  const models = provider.models.filter((model) => !isLegacyXaiBuiltinModel(model));
  if (models.length === provider.models.length) {
    return cfg;
  }
  return {
    ...cfg,
    models: {
      ...cfg.models,
      providers: {
        ...cfg.models?.providers,
        xai: {
          ...provider,
          models,
        },
      },
    },
  };
}

export function applyXaiProviderConfig(cfg: BranchConfig): BranchConfig {
  return xaiPresetAppliers.applyProviderConfig(pruneRetiredXaiBuiltinModels(cfg));
}

export function applyXaiConfig(cfg: BranchConfig): BranchConfig {
  return xaiPresetAppliers.applyConfig(pruneRetiredXaiBuiltinModels(cfg));
}

export function applyXaiOAuthConfig(
  cfg: BranchConfig,
  provider: ModelProviderConfig,
): BranchConfig {
  const next = applyOnboardAuthAgentModelsAndProviders(cfg, {
    agentModels: withAgentModelAliases(cfg.agents?.defaults?.models, [
      { modelRef: XAI_DEFAULT_MODEL_REF, alias: "Grok" },
    ]),
    providers: {
      xai: {
        ...provider,
        apiKey: undefined,
        authHeader: undefined,
        headers: undefined,
        request: { auth: undefined, headers: undefined },
      },
    },
  });
  return resolveAgentModelPrimaryValue(cfg.agents?.defaults?.model)
    ? next
    : applyAgentDefaultModelPrimary(next, XAI_DEFAULT_MODEL_REF);
}
