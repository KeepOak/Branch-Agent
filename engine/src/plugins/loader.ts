/** Stable public facade for plugin loading and runtime-registry resolution. */
import { loadBranchPlugins } from "./loader-runtime-load.js";
import type { PluginLoadOptions } from "./loader-types.js";
export { resolveCompatibleRuntimePluginRegistry } from "./active-runtime-registry.js";
export {
  clearPluginRegistryLoadCache,
  isPluginRegistryLoadInFlight,
  resolvePluginRegistryLoadCacheKey,
} from "./loader-cache.js";
export {
  resolveRuntimePluginRegistry,
  acquirePluginRegistryForInspection,
  loadAndActivateRootPluginRegistry,
} from "./loader-runtime-load.js";

/** Loads a caller-owned registry value without changing the process-wide active registry. */
export function loadPluginRegistryHandle(options: PluginLoadOptions = {}) {
  return loadBranchPlugins({ ...options, activate: false });
}

/** Collects CLI descriptors through the same validation and instance owner as runtime loading. */
export async function loadBranchPluginCliRegistry(options: PluginLoadOptions = {}) {
  return loadBranchPlugins({
    ...options,
    mode: "cli-metadata",
    activate: false,
  });
}

export { loadBranchPlugins };
export type { PluginLoadOptions };
