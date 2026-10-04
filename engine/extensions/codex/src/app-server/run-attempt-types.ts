import type {
  EmbeddedRunAttemptParamsV2 as EmbeddedRunAttemptParams,
  NativeHookRelayEvent,
} from "branch/plugin-sdk/agent-harness-runtime";
import type { PluginRuntime } from "branch/plugin-sdk/plugin-runtime";
import type { CodexAppServerBindingStore } from "./session-binding.js";
import type { CodexAppServerClientFactory } from "./shared-client.js";

export type CodexRunAttemptOptions = {
  bindingStore: CodexAppServerBindingStore;
  runtime?: PluginRuntime;
  pluginConfig?: unknown;
  /** Captured at native account admission; survives recovery clearing persisted bindings. */
  readonly nativeAccountHome?: string;
  /** Private app-server request identity; public attempt identity remains params.modelId. */
  runtimeModelId?: string;
  startupTimeoutFloorMs?: number;
  nativeHookRelay?: {
    enabled?: boolean;
    events?: readonly NativeHookRelayEvent[];
    ttlMs?: number;
    gatewayTimeoutMs?: number;
    hookTimeoutSec?: number;
  };
  clientFactory?: CodexAppServerClientFactory;
};

export type CodexRunAttemptInput = {
  params: EmbeddedRunAttemptParams;
  options: CodexRunAttemptOptions;
};
