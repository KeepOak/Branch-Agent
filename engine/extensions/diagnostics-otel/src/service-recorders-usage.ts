import { SpanStatusCode } from "@opentelemetry/api";
import { normalizeDiagnosticValue } from "branch/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "branch/plugin-sdk/diagnostic-runtime";
import { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
import {
  assignGenAiSpanIdentityAttrs,
  assignPositiveNumberAttr,
} from "./service-genai-attributes.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { MessageDeliveryDiagnosticEvent, TrustedSpanAliasOwner } from "./service-types.js";

export function createUsageRecorders(runtime: DiagnosticsRecorderRuntime) {
  const {
    tokensCounter,
    genAiTokenUsageHistogram,
    costCounter,
    durationHistogram,
    contextHistogram,
    webhookReceivedCounter,
    webhookErrorCounter,
    webhookDurationHistogram,
    messageQueuedCounter,
    messageReceivedCounter,
    messageDispatchStartedCounter,
    messageDispatchCompletedCounter,
    messageDispatchDurationHistogram,
    messageProcessedCounter,
    messageDurationHistogram,
    messageDeliveryStartedCounter,
    messageDeliveryDurationHistogram,
    queueDepthHistogram,
    tracer,
    activeTrustedSpans,
    activeTrustedSpanAliases,
    trustedSpanAliasKey,
    spanWithDuration,
    trustedTraceContext,
    internalOrTrustedTraceContext,
    internalOrTrustedExplicitParentContext,
    activeTrustedParentContext,
    activeInternalOrTrustedContext,
    trackTrustedSpan,
    trackInternalOrTrustedSpan,
    getTrackedInternalOrTrustedSpan,
    setSpanAttrs,
    completeTrackedLifecycleSpan,
    addRunAttrs,
    tracesEnabled,
  } = runtime;

  const recordModelUsage = (
    evt: Extract<DiagnosticEventPayload, { type: "model.usage" }>,
    metadata: DiagnosticEventMetadata,
    hostPluginId?: string,
  ) => {
    const attrs = {
      "branch.channel": evt.channel ?? "unknown",
      "branch.agent": normalizeDiagnosticValue(evt.agentId),
      "branch.provider": evt.provider ?? "unknown",
      "branch.model": evt.model ?? "unknown",
    };
    const genAiAttrs: Record<string, string> = {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": normalizeDiagnosticValue(evt.provider),
      "gen_ai.request.model": normalizeDiagnosticValue(evt.model),
    };

    const usage = evt.usage;
    for (const [tokenType, field] of [
      ["input", "input"],
      ["output", "output"],
      ["cache_read", "cacheRead"],
      ["cache_write", "cacheWrite"],
      ["prompt", "promptTokens"],
      ["total", "total"],
    ] as const) {
      const amount = usage[field];
      if (!amount) {
        continue;
      }
      tokensCounter.add(amount, { ...attrs, "branch.token": tokenType });
      if (tokenType === "input" || tokenType === "output") {
        genAiTokenUsageHistogram.record(amount, {
          ...genAiAttrs,
          "gen_ai.token.type": tokenType,
        });
      }
    }

    if (evt.costUsd) {
      costCounter.add(evt.costUsd, attrs);
    }
    if (evt.durationMs) {
      durationHistogram.record(evt.durationMs, attrs);
    }
    for (const kind of ["limit", "used"] as const) {
      const amount = evt.context?.[kind];
      if (amount) {
        contextHistogram.record(amount, { ...attrs, "branch.context": kind });
      }
    }

    if (!tracesEnabled) {
      return;
    }
    const genAiInputTokens =
      usage.promptTokens ?? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    const spanAttrs: Record<string, string | number> = {
      ...attrs,
      "branch.tokens.input": usage.input ?? 0,
      "branch.tokens.output": usage.output ?? 0,
      "branch.tokens.cache_read": usage.cacheRead ?? 0,
      "branch.tokens.cache_write": usage.cacheWrite ?? 0,
      "branch.tokens.total": usage.total ?? 0,
    };
    if (metadata.trusted && metadata.internal && hostPluginId) {
      spanAttrs["branch.plugin"] = normalizeDiagnosticValue(hostPluginId);
    }
    assignGenAiSpanIdentityAttrs(spanAttrs, evt);
    addRunAttrs(spanAttrs, evt);
    assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.input_tokens", genAiInputTokens);
    assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.output_tokens", usage.output);
    assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.cache_read.input_tokens", usage.cacheRead);
    assignPositiveNumberAttr(
      spanAttrs,
      "gen_ai.usage.cache_creation.input_tokens",
      usage.cacheWrite,
    );

    const span = spanWithDuration("branch.model.usage", spanAttrs, evt.durationMs, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  const recordWebhookReceived = (
    evt: Extract<DiagnosticEventPayload, { type: "webhook.received" }>,
  ) => {
    const attrs = {
      "branch.channel": evt.channel ?? "unknown",
      "branch.webhook": evt.updateType ?? "unknown",
    };
    webhookReceivedCounter.add(1, attrs);
  };

  const recordWebhookProcessed = (
    evt: Extract<DiagnosticEventPayload, { type: "webhook.processed" }>,
  ) => {
    const attrs = {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.webhook": normalizeDiagnosticValue(evt.updateType),
    };
    if (typeof evt.durationMs === "number") {
      webhookDurationHistogram.record(evt.durationMs, attrs);
    }
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number> = { ...attrs };
    const span = spanWithDuration("branch.webhook.processed", spanAttrs, evt.durationMs);
    span.end();
  };

  const recordWebhookError = (evt: Extract<DiagnosticEventPayload, { type: "webhook.error" }>) => {
    const attrs = {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.webhook": normalizeDiagnosticValue(evt.updateType),
    };
    webhookErrorCounter.add(1, attrs);
    if (!tracesEnabled) {
      return;
    }
    const redactedError = redactSensitiveText(evt.error);
    const spanAttrs: Record<string, string | number> = {
      ...attrs,
      "branch.error": redactedError,
    };
    const span = tracer.startSpan("branch.webhook.error", {
      attributes: spanAttrs,
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: redactedError });
    span.end();
  };

  const recordMessageQueued = (
    evt: Extract<DiagnosticEventPayload, { type: "message.queued" }>,
  ) => {
    const attrs = {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.source": normalizeDiagnosticValue(evt.source),
    };
    messageQueuedCounter.add(1, attrs);
    if (typeof evt.queueDepth === "number") {
      queueDepthHistogram.record(evt.queueDepth, attrs);
    }
  };

  const recordMessageReceived = (
    evt: Extract<DiagnosticEventPayload, { type: "message.received" }>,
  ) => {
    messageReceivedCounter.add(1, {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.source": normalizeDiagnosticValue(evt.source),
    });
  };

  const recordMessageDispatchStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.dispatch.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.source": normalizeDiagnosticValue(evt.source),
    };
    messageDispatchStartedCounter.add(1, attrs);
    if (!tracesEnabled) {
      return;
    }
    const traceContext = internalOrTrustedTraceContext(evt, metadata);
    if (!traceContext?.spanId || activeTrustedSpans.has(traceContext.spanId)) {
      return;
    }
    trackInternalOrTrustedSpan(
      evt,
      metadata,
      spanWithDuration("branch.message.processed", attrs, undefined, {
        parentContext: internalOrTrustedExplicitParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    );
  };

  const recordMessageDispatchCompleted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.dispatch.completed" }>,
  ) => {
    const attrs = {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.outcome": evt.outcome,
      "branch.reason": normalizeDiagnosticValue(evt.reason, "none"),
      "branch.source": normalizeDiagnosticValue(evt.source),
    };
    messageDispatchCompletedCounter.add(1, attrs);
    messageDispatchDurationHistogram.record(evt.durationMs, attrs);
  };

  const recordMessageProcessed = (
    evt: Extract<DiagnosticEventPayload, { type: "message.processed" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      "branch.channel": normalizeDiagnosticValue(evt.channel),
      "branch.outcome": evt.outcome ?? "unknown",
    };
    messageProcessedCounter.add(1, attrs);
    if (typeof evt.durationMs === "number") {
      messageDurationHistogram.record(evt.durationMs, attrs);
    }
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number> = { ...attrs };
    addRunAttrs(spanAttrs, evt);
    if (evt.reason) {
      spanAttrs["branch.reason"] = normalizeDiagnosticValue(evt.reason, "unknown");
    }
    const trackedSpan = getTrackedInternalOrTrustedSpan(evt, metadata);
    const span =
      trackedSpan ??
      spanWithDuration("branch.message.processed", spanAttrs, evt.durationMs, {
        parentContext: internalOrTrustedExplicitParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    setSpanAttrs(span, spanAttrs);
    if (evt.outcome === "error" && evt.error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactSensitiveText(evt.error) });
    }
    const traceContext = internalOrTrustedTraceContext(evt, metadata);
    completeTrackedLifecycleSpan(trackedSpan ? traceContext : undefined, span, evt.ts);
  };

  const messageDeliveryAttrs = (evt: MessageDeliveryDiagnosticEvent): Record<string, string> => ({
    "branch.channel": normalizeDiagnosticValue(evt.channel),
    "branch.delivery.kind": normalizeDiagnosticValue(evt.deliveryKind, "other"),
  });

  const recordMessageDeliveryStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.delivery.started" }>,
  ) => {
    messageDeliveryStartedCounter.add(1, messageDeliveryAttrs(evt));
  };

  const recordMessageDeliveryFinished = (
    evt: Extract<
      DiagnosticEventPayload,
      { type: "message.delivery.completed" | "message.delivery.error" }
    >,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      ...messageDeliveryAttrs(evt),
      "branch.outcome": evt.type === "message.delivery.error" ? "error" : "completed",
      ...(evt.type === "message.delivery.error"
        ? { "branch.errorCategory": normalizeDiagnosticValue(evt.errorCategory, "other") }
        : {}),
    };
    messageDeliveryDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }
    const span = spanWithDuration(
      "branch.message.delivery",
      {
        ...attrs,
        ...(evt.type === "message.delivery.completed"
          ? { "branch.delivery.result_count": evt.resultCount }
          : {}),
      },
      evt.durationMs,
      { parentContext: activeInternalOrTrustedContext(evt, metadata), endTimeMs: evt.ts },
    );
    if (evt.type === "message.delivery.error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactSensitiveText(evt.errorCategory),
      });
    }
    span.end(evt.ts);
  };

  const recordRunStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "run.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {};
    addRunAttrs(spanAttrs, evt);
    const span = trackTrustedSpan(
      evt,
      metadata,
      spanWithDuration("branch.run", spanAttrs, undefined, {
        parentContext: activeTrustedParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    );
    const parentSpanId = trustedTraceContext(evt, metadata)?.parentSpanId;
    if (parentSpanId && !activeTrustedSpans.has(parentSpanId)) {
      const owner: TrustedSpanAliasOwner = { kind: "run", id: evt.runId };
      activeTrustedSpanAliases.set(trustedSpanAliasKey(parentSpanId, owner), {
        span,
        spanId: parentSpanId,
        owner,
      });
    }
  };

  return {
    recordModelUsage,
    recordWebhookReceived,
    recordWebhookProcessed,
    recordWebhookError,
    recordMessageQueued,
    recordMessageReceived,
    recordMessageDispatchStarted,
    recordMessageDispatchCompleted,
    recordMessageProcessed,
    recordMessageDeliveryStarted,
    recordMessageDeliveryFinished,
    recordRunStarted,
  };
}
