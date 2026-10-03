import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "branch/plugin-sdk/plugin-config-runtime";
import { loadBrowserConfigForRuntimeRefresh } from "./browser/config-refresh-source.js";

/** Retains the policy owner's refusal reason alongside browser enablement. */
export function resolveBrowserPluginEnableState(cfg: BranchConfig) {
  return resolveEffectiveEnableState({
    id: "browser",
    origin: "bundled",
    config: normalizePluginsConfig(cfg.plugins),
    rootConfig: cfg,
    enabledByDefault: true,
  });
}

/** Explain a refused control-service start using existing policy and runtime facts. */
export async function describeBrowserControlUnavailable(
  cfg = loadBrowserConfigForRuntimeRefresh(),
): Promise<string> {
  const policy = resolveBrowserPluginEnableState(cfg);
  let reason = policy.reason;
  if (policy.enabled) {
    if (cfg.browser?.enabled === false) {
      return "browser control disabled: browser.enabled=false. Set browser.enabled=true.";
    }
    const { getPluginRuntimeGatewayRequestScope } =
      await import("branch/plugin-sdk/plugin-runtime");
    const record = getPluginRuntimeGatewayRequestScope()?.pluginRegistry?.plugins.find(
      (plugin) => plugin.id === "browser",
    );
    if (record?.status === "error") {
      const phase = record.failurePhase ? ` during ${record.failurePhase}` : "";
      return `browser control disabled: browser plugin failed${phase}: ${record.error ?? "no error detail recorded"}. Run \`branch doctor\` and check the Gateway logs.`;
    }
    reason = record?.status === "disabled" ? (record.activationReason ?? record.error) : undefined;
  }
  const enable = "Run `branch plugins enable browser`.";
  switch (reason) {
    case "not in allowlist":
      return `browser control disabled: "browser" is not in plugins.allow. Add "browser" to the existing plugins.allow list. ${enable}`;
    case "plugins disabled":
      return `browser control disabled: plugins.enabled=false. Set plugins.enabled=true. ${enable}`;
    case "blocked by denylist":
      return `browser control disabled: "browser" is in plugins.deny. Remove "browser" from plugins.deny. ${enable}`;
    case "disabled in config":
      return `browser control disabled: plugins.entries.browser.enabled=false. ${enable}`;
    default:
      return `browser control disabled: ${reason ?? "no availability reason was recorded"}. Run \`branch doctor\` and check the Gateway logs.`;
  }
}
