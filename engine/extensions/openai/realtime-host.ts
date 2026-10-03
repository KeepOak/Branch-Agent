// Full registration composes the same host operations supplied to a cold capability catalog.
import { resolveAgentDir } from "branch/plugin-sdk/agent-scope-runtime";
import { formatErrorMessage } from "branch/plugin-sdk/error-runtime";
import type { PluginCapabilityCatalogHostContext } from "branch/plugin-sdk/plugin-entry";
import {
  isProviderAuthProfileConfigured,
  resolveProviderAuthProfileApiKey,
} from "branch/plugin-sdk/provider-auth";
import {
  createProviderHttpError,
  readProviderJsonResponse,
  readProviderTextResponse,
  resolveProviderRequestHeaders,
} from "branch/plugin-sdk/provider-http";
import * as proxyCaptureSdk from "branch/plugin-sdk/proxy-capture";
import { createRealtimeTranscriptionWebSocketSession } from "branch/plugin-sdk/realtime-transcription-session";
import { warn } from "branch/plugin-sdk/runtime-env";
import { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
import { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";

// The shipped 2026.9.6 host lacks async diagnostics; remove optionality when the minimum advances.
const captureHost: Partial<Pick<typeof proxyCaptureSdk, "captureWsEventAsync">> = proxyCaptureSdk;

export const openAIRealtimeHost = {
  resolveAgentDir,
  isProviderAuthProfileConfigured,
  resolveProviderAuthProfileApiKey,
  resolveProviderRequestHeaders,
  createRealtimeTranscriptionWebSocketSession,
  captureWsEventAsync: captureHost.captureWsEventAsync,
  createDebugProxyWebSocketAgent: proxyCaptureSdk.createDebugProxyWebSocketAgent,
  resolveDebugProxySettings: proxyCaptureSdk.resolveDebugProxySettings,
  fetchWithSsrFGuard,
  createProviderHttpError,
  readProviderJsonResponse,
  readProviderTextResponse,
  formatErrorMessage,
  warn,
  redactSensitiveText,
} satisfies Omit<
  PluginCapabilityCatalogHostContext,
  | "isProviderApiKeyConfigured"
  | "resolveApiKeyForProvider"
  | "captureWsEvent"
  | "captureWsEventAsync"
> &
  Partial<Pick<PluginCapabilityCatalogHostContext, "captureWsEventAsync">>;

export type OpenAIRealtimeHost = typeof openAIRealtimeHost;
