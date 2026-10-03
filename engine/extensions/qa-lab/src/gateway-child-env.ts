import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SUPERVISOR_HINT_ENV_VARS } from "branch/plugin-sdk/process-runtime";
import { buildQaCodexAppServerArgs } from "./codex-app-server-args.js";
import type { QaProviderMode } from "./model-selection.js";
import {
  normalizeQaProviderModeEnv,
  resolveQaLiveCliAuthEnv,
  type QaCliBackendAuthMode,
} from "./providers/env.js";
import { getQaProvider } from "./providers/index.js";
import {
  QA_LIVE_ANTHROPIC_SETUP_TOKEN_ENV,
  QA_LIVE_SETUP_TOKEN_VALUE_ENV,
} from "./providers/live-frontier/auth.js";
import { listMockCodexModelInfos } from "./providers/shared/mock-model-config.js";
import type { RuntimeId } from "./runtime-id.js";

const QA_GATEWAY_CHILD_BLOCKED_ENV_VARS = Object.freeze([
  // QA owns this child; parent service and test-runner markers describe a different process.
  ...SUPERVISOR_HINT_ENV_VARS,
  "VITEST",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "BASH_ENV",
  "BASHOPTS",
  "ENV",
  "BRANCH_QA_CONVEX_SECRET_CI",
  "BRANCH_QA_CONVEX_SECRET_MAINTAINER",
  "BRANCH_QA_SUT_FORBIDDEN_SENTINEL",
  "BRANCH_QA_TELEGRAM_GROUP_ID",
  "BRANCH_QA_TELEGRAM_DRIVER_BOT_TOKEN",
  "BRANCH_QA_TELEGRAM_SUT_BOT_TOKEN",
  "SHELLOPTS",
]);

function scrubQaGatewayChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const envKey of QA_GATEWAY_CHILD_BLOCKED_ENV_VARS) {
    delete env[envKey];
  }
  // Bash imports exported functions before the launcher can apply its allowlist.
  for (const envKey of Object.keys(env)) {
    if (envKey.startsWith("BASH_FUNC_")) {
      delete env[envKey];
    }
  }
  if (env.NODE_ENV === "test") {
    delete env.NODE_ENV;
  }
  return env;
}

export function buildQaRuntimeEnv(params: {
  configPath: string;
  gatewayToken: string;
  homeDir: string;
  forwardHostHome?: boolean;
  stateDir: string;
  tempRoot: string;
  xdgConfigHome: string;
  xdgDataHome: string;
  xdgCacheHome: string;
  bundledPluginsDir?: string;
  stagedBundledPluginsRoot?: string | null;
  compatibilityHostVersion?: string;
  developmentSourceRoot: string | null;
  providerMode?: QaProviderMode;
  baseEnv?: NodeJS.ProcessEnv;
  runtimeEnvPatch?: NodeJS.ProcessEnv;
  forwardHostHomeForClaudeCli?: boolean;
  claudeCliAuthMode?: QaCliBackendAuthMode;
}) {
  const baseEnv = params.baseEnv ?? process.env;
  const provider = params.providerMode ? getQaProvider(params.providerMode) : null;
  const forwardedHostHome = params.forwardHostHome
    ? baseEnv.HOME?.trim() || os.homedir()
    : undefined;
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    HOME: forwardedHostHome ?? params.homeDir,
    ...(provider?.appliesLiveEnvAliases
      ? resolveQaLiveCliAuthEnv(baseEnv, {
          forwardHostHomeForClaudeCli: params.forwardHostHomeForClaudeCli,
          claudeCliAuthMode: params.claudeCliAuthMode,
        })
      : {}),
    BRANCH_HOME: params.homeDir,
    BRANCH_CONFIG_PATH: params.configPath,
    BRANCH_STATE_DIR: params.stateDir,
    BRANCH_OAUTH_DIR: path.join(params.stateDir, "credentials"),
    BRANCH_GATEWAY_TOKEN: params.gatewayToken,
    BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
    BRANCH_SKIP_GMAIL_WATCHER: "1",
    BRANCH_SKIP_CANVAS_HOST: "1",
    BRANCH_SKIP_STARTUP_MODEL_PREWARM: "1",
    BRANCH_NO_RESPAWN: "1",
    BRANCH_TEST_FAST: "1",
    BRANCH_EMBEDDED_ABORT_SETTLE_TIMEOUT_MS: "2000",
    BRANCH_QA_TEMP_ROOT: params.tempRoot,
    ...(params.stagedBundledPluginsRoot
      ? { BRANCH_QA_STAGED_RUNTIME_ROOT: params.stagedBundledPluginsRoot }
      : {}),
    BRANCH_QA_ALLOW_LOCAL_IMAGE_PROVIDER: "1",
    // QA uses the fast runtime envelope for speed, but it still exercises
    // normal config-driven heartbeats and runtime config writes.
    BRANCH_ALLOW_SLOW_REPLY_TESTS: "1",
    XDG_CONFIG_HOME: params.xdgConfigHome,
    XDG_DATA_HOME: params.xdgDataHome,
    XDG_CACHE_HOME: params.xdgCacheHome,
    ...(params.bundledPluginsDir ? { BRANCH_BUNDLED_PLUGINS_DIR: params.bundledPluginsDir } : {}),
    ...(params.compatibilityHostVersion
      ? { BRANCH_COMPATIBILITY_HOST_VERSION: params.compatibilityHostVersion }
      : {}),
  };
  const normalizedEnv = normalizeQaProviderModeEnv(env, params.providerMode);
  // Test-runner skip flags are parent controls; each QA child declares its own runtime needs.
  delete normalizedEnv.BRANCH_SKIP_CHANNELS;
  delete normalizedEnv.BRANCH_SKIP_PROVIDERS;
  delete normalizedEnv.BRANCH_SKIP_CRON;
  Object.assign(normalizedEnv, params.runtimeEnvPatch);
  // Child scratch and default compiler caches share the Gateway's joined cleanup lifetime.
  normalizedEnv.TMPDIR = params.tempRoot;
  normalizedEnv.TMP = params.tempRoot;
  normalizedEnv.TEMP = params.tempRoot;
  // Path isolation alone still lets CLI bootstrap discover the operator's service.
  normalizedEnv.BRANCH_PROFILE = `qa-${createHash("sha256")
    .update(params.tempRoot)
    .digest("hex")
    .slice(0, 24)}`;
  if (params.developmentSourceRoot === null) {
    delete normalizedEnv.BRANCH_DEV_SOURCE_ROOT;
  } else {
    normalizedEnv.BRANCH_DEV_SOURCE_ROOT = params.developmentSourceRoot;
  }
  // Direct Gateway launches need the same private-QA build and SDK admission
  // as the QA CLI; caller patches cannot disable either half of that contract.
  normalizedEnv.BRANCH_BUILD_PRIVATE_QA = "1";
  normalizedEnv.BRANCH_ENABLE_PRIVATE_QA_CLI = "1";
  normalizedEnv.BRANCH_GATEWAY_HOST_LIFELINE = "stdin";
  // Parent shell startup controls must be removed after caller patches so no
  // launcher or runtime child can import them before its own allowlist runs.
  delete normalizedEnv[QA_LIVE_ANTHROPIC_SETUP_TOKEN_ENV];
  delete normalizedEnv[QA_LIVE_SETUP_TOKEN_VALUE_ENV];
  return scrubQaGatewayChildEnv(normalizedEnv);
}

export async function stageQaCodexMockModelCatalog(params: {
  tempRoot: string;
  forcedRuntime?: RuntimeId;
  providerMode: QaProviderMode;
  primaryModel?: string;
  alternateModel?: string;
  autoCompactTokenLimit?: number;
}): Promise<string | undefined> {
  if (params.forcedRuntime !== "codex" || params.providerMode !== "mock-openai") {
    return undefined;
  }
  const modelCatalogPath = path.join(params.tempRoot, "codex-model-catalog.json");
  const selectedModelRefs = [params.primaryModel, params.alternateModel].filter(
    (model): model is string => typeof model === "string" && model.length > 0,
  );
  const models = listMockCodexModelInfos(selectedModelRefs);
  if (params.autoCompactTokenLimit !== undefined) {
    for (const model of models) {
      Object.assign(model, { auto_compact_token_limit: params.autoCompactTokenLimit });
    }
  }
  await fs.writeFile(modelCatalogPath, `${JSON.stringify({ models }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return modelCatalogPath;
}

export function buildQaForcedRuntimeEnvPatch(params: {
  forcedRuntime?: RuntimeId;
  providerMode: QaProviderMode;
  providerBaseUrl?: string;
  codexModelCatalogPath?: string;
  nativeAppServerArgs?: string;
}): NodeJS.ProcessEnv | undefined {
  if (!params.forcedRuntime) {
    return undefined;
  }
  const patch: NodeJS.ProcessEnv = {
    BRANCH_BUILD_PRIVATE_QA: "1",
    BRANCH_QA_FORCE_RUNTIME: params.forcedRuntime,
  };
  if (params.forcedRuntime !== "codex") {
    return patch;
  }
  if (params.providerMode !== "mock-openai") {
    patch.BRANCH_CODEX_APP_SERVER_ARGS = buildQaCodexAppServerArgs({
      existingArgs: params.nativeAppServerArgs,
    });
    return patch;
  }
  const providerBaseUrl = params.providerBaseUrl?.trim().replace(/\/+$/u, "");
  if (!providerBaseUrl) {
    throw new Error("forced Codex mock QA requires the managed mock provider URL");
  }
  if (!params.codexModelCatalogPath) {
    throw new Error("forced Codex mock QA requires the staged native model catalog");
  }
  patch.BRANCH_CODEX_APP_SERVER_ARGS = buildQaCodexAppServerArgs({
    providerBaseUrl,
    modelCatalogPath: params.codexModelCatalogPath,
  });
  return patch;
}
