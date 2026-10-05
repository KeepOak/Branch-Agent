// Public contract-safe web-search registration helpers for provider plugins.

import type { BranchConfig } from "../config/types.branch.js";
import type { WebSearchProviderPlugin, WebSearchProviderToolDefinition } from "../plugins/types.js";
import { enablePluginInConfig } from "./provider-enable-config.js";
import {
  createBaseWebSearchProviderContractFields,
  type CreateWebSearchProviderContractFieldsOptions,
} from "./provider-web-search-contract-fields.js";
export {
  getScopedCredentialValue,
  resolveProviderWebSearchPluginConfig,
  setScopedCredentialValue,
  setProviderWebSearchPluginConfigValue,
} from "../agents/tools/web-search-provider-config.js";
export { enablePluginInConfig } from "./provider-enable-config.js";
export type { WebSearchProviderPlugin, WebSearchProviderToolDefinition };

type CreateWebSearchProviderSelectionOptions = CreateWebSearchProviderContractFieldsOptions & {
  /** Plugin id to enable when this provider is selected through setup/configuration flows. */
  selectionPluginId?: string;
};

/** Build the public web-search provider hooks, including optional selection-time plugin enabling. */
export function createWebSearchProviderContractFields(
  options: CreateWebSearchProviderSelectionOptions,
): Pick<
  WebSearchProviderPlugin,
  "inactiveSecretPaths" | "getCredentialValue" | "setCredentialValue"
> &
  Partial<
    Pick<
      WebSearchProviderPlugin,
      "applySelectionConfig" | "getConfiguredCredentialValue" | "setConfiguredCredentialValue"
    >
  > {
  const selectionPluginId = options.selectionPluginId;

  return {
    ...createBaseWebSearchProviderContractFields(options),
    ...(selectionPluginId
      ? {
          applySelectionConfig: (config: BranchConfig) =>
            enablePluginInConfig(config, selectionPluginId).config,
        }
      : {}),
  };
}
