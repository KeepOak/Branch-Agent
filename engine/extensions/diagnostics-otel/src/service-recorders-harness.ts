import { SpanStatusCode } from "@opentelemetry/api";
import {
  normalizeDiagnosticValue,
  normalizeDiagnosticLane,
} from "branch/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
  DiagnosticEventPrivateData,
} from "branch/plugin-sdk/diagnostic-runtime";
import { redactOtelAttributes } from "./service-attributes.js";
import { normalizeOtelErrorMessage } from "./service-content-normalization.js";
import { assignOtelModelContentAttributes } from "./service-genai-content.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { HarnessRunDiagnosticEvent, ModelFailoverDiagnosticEvent } from "./service-types.js";

export function createHarnessRecorders(runtime: DiagnosticsRecorderRuntime) {
  const {
    harnessDurationHistogram,
    modelFailoverCounter,
    activeTrustedSpans,
    spanWithDuration,
    trustedTraceContext,
    activeTrustedParentContext,
    trackTrustedSpan,
    setSpanAttrs,
    completeTrackedLifecycleSpan,
    addRunAttrs,
    tracesEnabled,
    getTrackedInternalOrTrustedSpan,
    contentCapturePolicy,
  } = runtime;

  const recordAgentCommentary = (
    evt: Extract<DiagnosticEventPayload, { type: "agent.commentary" }>,
    metadata: DiagnosticEventMetadata,
    privateData: DiagnosticEventPrivateData,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return;
    }
    const span = getTrackedInternalOrTrustedSpan(evt, metadata);
    if (!span) {
      return;
    }
    const attrs: Record<string, string | number | boolean> = {
      "branch.harness.id": normalizeDiagnosticValue(evt.harnessId, "unknown"),
      "branch.commentary.sequence": evt.sourceSequence,
      "branch.commentary.text_length": evt.textLength,
      "branch.commentary.content_truncated": evt.contentTruncated,
    };
    assignOtelModelContentAttributes(attrs, privateData.modelContent, contentCapturePolicy);
    // addEvent bypasses setSpanAttrs; apply the same redaction and identifier
    // policy. Queued commentary precedes queued harness completion.
    span.addEvent("branch.agent.commentary", redactOtelAttributes(attrs), evt.sourceTimestampMs);
  };

  const harnessRunMetricAttrs = (evt: HarnessRunDiagnosticEvent) => ({
    "branch.harness.id": normalizeDiagnosticValue(evt.harnessId, "unknown"),
    "branch.harness.plugin": normalizeDiagnosticValue(evt.pluginId),
    ...(evt.type === "harness.run.started"
      ? {}
      : {
          "branch.outcome": evt.type === "harness.run.error" ? "error" : evt.outcome,
        }),
    "branch.provider": normalizeDiagnosticValue(evt.provider, "unknown"),
    "branch.model": normalizeDiagnosticValue(evt.model, "unknown"),
    ...(evt.channel ? { "branch.channel": normalizeDiagnosticValue(evt.channel) } : {}),
  });

  const recordHarnessRunStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "harness.run.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      ...harnessRunMetricAttrs(evt),
    };
    addRunAttrs(spanAttrs, evt);
    trackTrustedSpan(
      evt,
      metadata,
      spanWithDuration("branch.harness.run", spanAttrs, undefined, {
        parentContext: activeTrustedParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    );
  };

  const recordHarnessRunFinished = (
    evt: Extract<DiagnosticEventPayload, { type: "harness.run.completed" | "harness.run.error" }>,
    metadata: DiagnosticEventMetadata,
    privateData: DiagnosticEventPrivateData,
  ) => {
    const errorType =
      evt.type === "harness.run.error"
        ? normalizeDiagnosticValue(evt.errorCategory, "other")
        : "error";
    const attrs = {
      ...harnessRunMetricAttrs(evt),
      ...(evt.type === "harness.run.error"
        ? { "branch.harness.phase": evt.phase, "branch.errorCategory": errorType }
        : {}),
    };
    harnessDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = { ...attrs };
    addRunAttrs(spanAttrs, evt);
    if (evt.type === "harness.run.completed") {
      if (evt.resultClassification) {
        spanAttrs["branch.harness.result_classification"] = normalizeDiagnosticValue(
          evt.resultClassification,
        );
      }
      if (typeof evt.yieldDetected === "boolean") {
        spanAttrs["branch.harness.yield_detected"] = evt.yieldDetected;
      }
      if (evt.itemLifecycle) {
        spanAttrs["branch.harness.items.started"] = evt.itemLifecycle.startedCount;
        spanAttrs["branch.harness.items.completed"] = evt.itemLifecycle.completedCount;
        spanAttrs["branch.harness.items.active"] = evt.itemLifecycle.activeCount;
      }
    } else {
      spanAttrs["error.type"] = errorType;
      if (evt.cleanupFailed) {
        spanAttrs["branch.harness.cleanup_failed"] = true;
      }
    }
    // Redacted message goes on the span only, never the low-cardinality metric attrs.
    const redactedError = normalizeOtelErrorMessage(privateData.errorMessage);
    if (redactedError) {
      spanAttrs["branch.error"] = redactedError;
    }
    const trustedTrace = trustedTraceContext(evt, metadata);
    const trackedSpan = trustedTrace?.spanId
      ? activeTrustedSpans.get(trustedTrace.spanId)
      : undefined;
    const span =
      trackedSpan ??
      spanWithDuration("branch.harness.run", spanAttrs, evt.durationMs, {
        parentContext: activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    setSpanAttrs(span, spanAttrs);
    if (evt.type === "harness.run.error" || evt.outcome === "error") {
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactedError ?? errorType });
    }
    // Aborted runs also retain their context for late children.
    if (trackedSpan && trustedTrace?.spanId) {
      completeTrackedLifecycleSpan(trustedTrace, trackedSpan, evt.ts);
      return;
    }
    span.end(evt.ts);
  };

  const recordContextAssembled = (
    evt: Extract<DiagnosticEventPayload, { type: "context.assembled" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "branch.context.message_count": evt.messageCount,
      "branch.context.history_text_chars": evt.historyTextChars,
      "branch.context.history_image_blocks": evt.historyImageBlocks,
      "branch.context.max_message_text_chars": evt.maxMessageTextChars,
      "branch.context.system_prompt_chars": evt.systemPromptChars,
      "branch.context.prompt_chars": evt.promptChars,
      "branch.context.prompt_images": evt.promptImages,
    };
    addRunAttrs(spanAttrs, evt);
    if (evt.contextTokenBudget !== undefined) {
      spanAttrs["branch.context.token_budget"] = evt.contextTokenBudget;
    }
    if (evt.reserveTokens !== undefined) {
      spanAttrs["branch.context.reserve_tokens"] = evt.reserveTokens;
    }
    const span = spanWithDuration("branch.context.assembled", spanAttrs, 0, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  const recordModelFailover = (
    evt: ModelFailoverDiagnosticEvent,
    metadata: DiagnosticEventMetadata,
  ) => {
    const metricAttrs: Record<string, string> = {
      "branch.failover.reason": normalizeDiagnosticValue(evt.reason, "unknown"),
      "branch.failover.suspended":
        evt.suspended === undefined ? "unknown" : String(evt.suspended),
      "branch.lane": normalizeDiagnosticLane(evt.lane, "unknown"),
      "branch.model": normalizeDiagnosticValue(evt.fromModel),
      "branch.provider": normalizeDiagnosticValue(evt.fromProvider),
      "branch.failover.to_model": normalizeDiagnosticValue(evt.toModel),
      "branch.failover.to_provider": normalizeDiagnosticValue(evt.toProvider),
    };
    modelFailoverCounter.add(1, metricAttrs);
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "branch.failover.reason": normalizeDiagnosticValue(evt.reason, "unknown"),
    };
    if (evt.fromProvider) {
      spanAttrs["branch.provider"] = evt.fromProvider;
    }
    if (evt.fromModel) {
      spanAttrs["branch.model"] = evt.fromModel;
    }
    if (evt.toProvider) {
      spanAttrs["branch.failover.to_provider"] = evt.toProvider;
    }
    if (evt.toModel) {
      spanAttrs["branch.failover.to_model"] = evt.toModel;
    }
    if (evt.lane) {
      spanAttrs["branch.lane"] = normalizeDiagnosticLane(evt.lane, "unknown");
    }
    if (evt.suspended !== undefined) {
      spanAttrs["branch.failover.suspended"] = evt.suspended;
    }
    if (evt.cascadeDepth !== undefined) {
      spanAttrs["branch.failover.cascade_depth"] = evt.cascadeDepth;
    }
    const span = spanWithDuration("branch.model.failover", spanAttrs, 0, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  return {
    recordAgentCommentary,
    recordHarnessRunStarted,
    recordHarnessRunFinished,
    recordContextAssembled,
    recordModelFailover,
  };
}
