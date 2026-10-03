import type { Api, Model, StreamFn } from "@branch/llm-core";
import { getAiTransportHost } from "../host.js";
import { createAnthropicMessagesTransportStreamFn } from "./anthropic-transport-stream.js";
import { createOpenAICompletionsTransportStreamFn } from "./openai-completions-transport.js";
import { OPENAI_RESPONSES_APIS } from "./openai-responses-contracts.js";
import {
  createAzureOpenAIResponsesTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
} from "./openai-responses-transport.js";
import { resolveOpencodeSessionHeaders } from "./session-affinity.js";

const SUPPORTED_TRANSPORT_APIS = new Set<Api>([
  "openai-responses",
  "openai-chatgpt-responses",
  "openai-completions",
  "azure-openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);

const SIMPLE_TRANSPORT_API_ALIAS: Record<string, Api> = {
  "openai-completions": "branch-openai-completions-transport",
  "anthropic-messages": "branch-anthropic-messages-transport",
  "google-generative-ai": "branch-google-generative-ai-transport",
};

type ProviderTransportStreamContext = {
  cfg?: unknown;
  agentDir?: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
};

function createProviderOwnedGoogleTransportStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  const resolveStream = (provider: string) =>
    getAiTransportHost().plugin.resolveProviderStream({
      provider,
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    });
  const streamFn = resolveStream(model.provider) ?? resolveStream("google") ?? undefined;
  return streamFn
    ? (requestModel, context, options) =>
        streamFn(requestModel, context, {
          ...options,
          headers: resolveOpencodeSessionHeaders(requestModel, options),
        })
    : undefined;
}

function createSupportedTransportStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  switch (model.api) {
    case "openai-responses":
    case "openai-chatgpt-responses":
      return createOpenAIResponsesTransportStreamFn();
    case "openai-completions":
      return createOpenAICompletionsTransportStreamFn();
    case "azure-openai-responses":
      return createAzureOpenAIResponsesTransportStreamFn();
    case "anthropic-messages":
      return createAnthropicMessagesTransportStreamFn();
    case "google-generative-ai":
      return createProviderOwnedGoogleTransportStreamFn(model, ctx);
    default:
      return undefined;
  }
}

/** Maps public model APIs to the internal transport API id used by simple runtime dispatch. */
export function resolveTransportAwareSimpleApi(api: Api): Api | undefined {
  if (OPENAI_RESPONSES_APIS.has(api)) {
    const alias = `branch-${api}-transport` as Api;
    return OPENAI_RESPONSES_APIS.has(alias) ? alias : undefined;
  }
  return SIMPLE_TRANSPORT_API_ALIAS[api];
}

/** Creates a managed transport stream only when request overrides require it. */
export function createTransportAwareStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  if (!getAiTransportHost().requiresManagedTransport(model)) {
    return undefined;
  }
  if (!SUPPORTED_TRANSPORT_APIS.has(model.api)) {
    throw new Error(
      `Model-provider request.proxy/request.tls/localService is not yet supported for api "${model.api}"`,
    );
  }
  const streamFn = createSupportedTransportStreamFn(model, ctx);
  if (!streamFn) {
    throw new Error(`Managed transport stream is unavailable for api "${model.api}"`);
  }
  return streamFn;
}

/** Creates a managed Branch Agent transport stream for explicit fallback/runtime callers. */
export function createBranchTransportStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  // Explicit fallback callers use this when they need Branch Agent's HTTP
  // transport semantics regardless of the default embedded-runner strategy.
  // Native OpenAI HTTP still depends on this path for strict tool shaping,
  // attribution, cache-boundary stripping, and runtime credential injection.
  return createSupportedTransportStreamFn(model, ctx);
}

export function createBoundaryAwareStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  // Default embedded-runner fallback. Keep OpenAI-family APIs here while native
  // HTTP streams preserve the same Branch Agent request contract.
  return createSupportedTransportStreamFn(model, ctx);
}

export function prepareTransportAwareSimpleModel<TApi extends Api>(
  model: Model<TApi>,
  ctx?: ProviderTransportStreamContext,
): Model {
  const streamFn = createTransportAwareStreamFnForModel(model as Model, ctx);
  const alias = resolveTransportAwareSimpleApi(model.api);
  if (!streamFn || !alias) {
    return model;
  }
  return getAiTransportHost().inheritManagedTransport(model, {
    ...model,
    api: alias,
  });
}

export function buildTransportAwareSimpleStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  return createTransportAwareStreamFnForModel(model, ctx);
}
