import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { parseJsonWithJson5Fallback } from "../utils/parse-json-compat.js";
import { applyConfigEnvVars } from "./config-env-vars.js";
import { resolveConfigEnvVars } from "./env-substitution.js";
import { resolveConfigIncludes } from "./includes.js";
import { resolveConfigPath, resolveIncludeRoots } from "./paths.js";
import type { BranchConfig } from "./types.branch.js";

const GATEWAY_DISPATCH_SHELL_ENV_EXPECTED_KEYS = [
  "BRANCH_GATEWAY_TOKEN",
  "BRANCH_GATEWAY_PASSWORD",
] as const;

const GATEWAY_DISPATCH_TOP_LEVEL_KEYS = [
  "agents",
  "env",
  "gateway",
  "plugins",
  "secrets",
  "session",
] as const;

/** Options for reading the reduced config surface used by Gateway dispatch. */
type GatewayDispatchConfigReadOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, "warn" | "error">;
};

function resolveGatewayDispatchConfig(value: unknown, env: NodeJS.ProcessEnv): BranchConfig {
  if (!isRecord(value)) {
    return {};
  }
  if (Object.hasOwn(value, "env")) {
    applyConfigEnvVars(value as BranchConfig, env);
  }
  const projected: Record<string, unknown> = {};
  for (const key of GATEWAY_DISPATCH_TOP_LEVEL_KEYS) {
    if (Object.hasOwn(value, key)) {
      projected[key] = value[key];
    }
  }
  // Substitution owns the fresh nested containers; discarded branches need neither
  // substitution nor another deep copy after the complete include graph is resolved.
  return resolveConfigEnvVars(projected, env, { onMissing: () => undefined }) as BranchConfig;
}

// Main session keys are process-local; Gateway dispatch always sees the canonical main key.
function applyGatewayDispatchSessionDefaults(config: BranchConfig): BranchConfig {
  if (config.session?.mainKey === undefined) {
    return config;
  }
  return {
    ...config,
    session: { ...config.session, mainKey: "main" },
  };
}

function readRawGatewayDispatchConfig(options: GatewayDispatchConfigReadOptions = {}): {
  config: BranchConfig;
  configPath: string;
} {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? resolveConfigPath(env);
  if (!fs.existsSync(configPath)) {
    return { config: {}, configPath };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseJsonWithJson5Fallback(raw);
  const resolvedIncludes = resolveConfigIncludes(parsed, configPath, undefined, {
    allowedRoots: resolveIncludeRoots(env),
  });
  const resolvedConfig = resolveGatewayDispatchConfig(resolvedIncludes, env);
  return {
    config: applyGatewayDispatchSessionDefaults(resolvedConfig),
    configPath,
  };
}

export function readGatewayDispatchConfig(
  options: GatewayDispatchConfigReadOptions = {},
): BranchConfig {
  return readRawGatewayDispatchConfig(options).config;
}

export async function readGatewayDispatchConfigWithShellEnvFallback(
  options: GatewayDispatchConfigReadOptions = {},
): Promise<BranchConfig> {
  const env = options.env ?? process.env;
  const firstRead = readRawGatewayDispatchConfig(options);
  const {
    loadShellEnvFallback,
    resolveShellEnvFallbackTimeoutMs,
    shouldDeferShellEnvFallback,
    shouldEnableShellEnvFallback,
  } = await import("../infra/shell-env.js");
  const enabled =
    shouldEnableShellEnvFallback(env) || firstRead.config.env?.shellEnv?.enabled === true;
  if (enabled && !shouldDeferShellEnvFallback(env)) {
    loadShellEnvFallback({
      enabled: true,
      env,
      expectedKeys: [...GATEWAY_DISPATCH_SHELL_ENV_EXPECTED_KEYS],
      logger: options.logger ?? console,
      timeoutMs: firstRead.config.env?.shellEnv?.timeoutMs ?? resolveShellEnvFallbackTimeoutMs(env),
    });
  }
  return readGatewayDispatchConfig({ ...options, configPath: path.resolve(firstRead.configPath) });
}
