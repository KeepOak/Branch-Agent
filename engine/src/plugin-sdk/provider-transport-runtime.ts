// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/plugin-sdk/provider-transport-runtime.ts (atlas AGENT-LOOP-0096). Changed for Branch: preserve Gemini call IDs/signatures and harden outbound histories per R-1633 and the pinned Gemini CLI.
/**
 * Runtime SDK subpath for provider transport helpers and stream primitives.
 */
export { buildGuardedModelFetch } from "../agents/provider-transport-fetch.js";
export { buildOpenAICompletionsParams } from "../agents/openai-transport-stream.js";
export { buildAssistantMessage } from "../agents/stream-message-shared.js";
export {
  sortPromptCacheToolsByName,
  splitSystemPromptCacheBoundary,
  stripSystemPromptCacheBoundary,
} from "@branch/ai/internal/shared";
export { transformTransportMessages } from "../agents/transport-message-transform.js";
export {
  describeToolResultMediaPlaceholder,
  describeUnsupportedToolResultMedia,
  extractToolResultText,
  formatToolResultText,
  isImageWithMediaPayload,
} from "@branch/ai/internal/shared";
export {
  coerceTransportToolCallArguments,
  consumeGoogleGenerateContentStream,
  convertGoogleTools,
  projectGoogleMessages,
  hardenGoogleContents,
  requiresGoogleToolCallId,
  type GoogleStreamChunk,
  copyProviderAcceptanceObserver,
  createEmptyTransportUsage,
  createWritableTransportEventStream,
  failTransportStream,
  finalizeTerminalToolCallArguments,
  finalizeTransportStream,
  MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE,
  mergeTransportHeaders,
  notifyProviderHttpMetadata,
  notifyProviderHttpResponse,
  notifyProviderStreamOpened,
  parseTerminalToolCallArguments,
  sanitizeTransportPayloadText,
  withProviderAcceptanceObserver,
  type WritableTransportStream,
} from "@branch/ai/transports";
