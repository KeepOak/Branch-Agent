import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { getPreparedPluginSecretInput } from "branch/plugin-sdk/secret-input-runtime";
import { runtimeConfig, type RuntimeConfig } from "./config.js";

/** Only host-prepared capability snapshots may supply a credential. Never resolve or cache refs. */
export function resolveRuntimeConfig(
  snapshot: ReturnType<BranchPluginApi["runtime"]["config"]["current"]>,
): RuntimeConfig {
  const configured = snapshot.plugins?.entries?.typesafe?.config;
  const validated = runtimeConfig(configured);
  if (validated.baseUrl) {
    return validated;
  }
  const prepared = getPreparedPluginSecretInput("typesafe", "apiKey");
  return { ...validated, apiKey: prepared.value };
}
