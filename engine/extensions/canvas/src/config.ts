import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolvePluginConfigObject } from "branch/plugin-sdk/plugin-config-runtime";
import { isTruthyEnvValue } from "branch/plugin-sdk/runtime-env";
import { asBoolean as readBoolean, isRecord } from "branch/plugin-sdk/string-coerce-runtime";

export type CanvasHostConfig = {
  enabled?: boolean;
};

export type CanvasPluginConfig = {
  host?: CanvasHostConfig;
};

export function parseCanvasPluginConfig(value: unknown): CanvasPluginConfig {
  if (!isRecord(value) || !isRecord(value.host)) {
    return {};
  }
  const enabled = readBoolean(value.host.enabled);
  return { host: enabled === undefined ? {} : { enabled } };
}

export function resolveCanvasHostConfig(params: {
  config?: BranchConfig;
  pluginConfig?: Record<string, unknown>;
}): CanvasHostConfig {
  const pluginConfig =
    params.pluginConfig ?? resolvePluginConfigObject(params.config, "canvas") ?? {};
  const parsedPluginConfig = parseCanvasPluginConfig(pluginConfig);
  return parsedPluginConfig.host ?? {};
}

export function isCanvasHostEnabled(config?: BranchConfig): boolean {
  if (isTruthyEnvValue(process.env.BRANCH_SKIP_CANVAS_HOST)) {
    return false;
  }
  return resolveCanvasHostConfig({ config }).enabled !== false;
}

export const canvasConfigSchema = {
  parse: parseCanvasPluginConfig,
};
