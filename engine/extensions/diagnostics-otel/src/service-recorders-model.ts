import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { normalizeDiagnosticValue } from "branch/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
  DiagnosticModelCallContent,
} from "branch/plugin-sdk/diagnostic-runtime";
import { asPositiveFiniteNumber } from "branch/plugin-sdk/number-runtime";
import { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
import {
  addUpstreamRequestIdSpanEvent,
  assignGenAiModelCallAttrs,
  assignModelCallPromptStatsAttrs,
  assignModelCallSizeTimingAttrs,
  assignModelCallUsageAttrs,
  genAiOperationName,
  modelCallSpanName,
  modelCallObservationUnit,
} from "./service-genai-attributes.js";
import { assignOtelModelContentAttributes } from "./service-genai-content.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { ModelCallLifecycleDiagnosticEvent } from "./service-types.js";

export function createModelRecorders(runtime: DiagnosticsRecorderRuntime) {
  const {
    genAiOperationDurationHistogram,
    modelCallDurationHistogram,
    modelCallRequestBytesHistogram,
    modelCallResponseBytesHistogram,
    modelCallTimeToFirstByteHistogram,
    spanWithDuration,
    activeTrustedParentContext,
    trackTrustedSpan,
    getTrackedInternalOrTrustedSpan,
    takeTrackedTrustedSpan,
    setSpanAttrs,
    addRunAttrs,
    contentCapturePolicy,
    tracesEnabled,
  } = runtime;

  const modelCallMetricAttrs = (evt: ModelCallLifecycleDiagnosticEvent) => ({
    "branch.provider": evt.provider,
    "branch.model": evt.model,
    "branch.api": normalizeDiagnosticValue(evt.api),
    "branch.transport": normalizeDiagnosticValue(evt.transport),
    "branch.model_call.observation_unit": modelCallObservationUnit(evt),
  });
  const recordModelCallSizeTimingMetrics = (
    evt: Extract<DiagnosticEventPayload, { type: "model.call.completed" | "model.call.error" }>,
    attrs: ReturnType<typeof modelCallMetricAttrs>,
  ) => {
    const requestPayloadBytes = asPositiveFiniteNumber(evt.requestPayloadBytes);
    if (requestPayloadBytes !== undefined) {
      modelCallRequestBytesHistogram.record(requestPayloadBytes, attrs);
    }
    const responseStreamBytes = asPositiveFiniteNumber(evt.responseStreamBytes);
    if (responseStreamBytes !== undefined) {
      modelCallResponseBytesHistogram.record(responseStreamBytes, attrs);
    }
    const timeToFirstByteMs = asPositiveFiniteNumber(evt.timeToFirstByteMs);
    if (timeToFirstByteMs !== undefined) {
      modelCallTimeToFirstByteHistogram.record(timeToFirstByteMs, attrs);
    }
  };

  const recordModelCallStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "model.call.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return undefined;
    }
    const trackedSpan = getTrackedInternalOrTrustedSpan(evt, metadata);
    if (trackedSpan) {
      return trackedSpan.spanContext();
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "branch.provider": evt.provider,
      "branch.model": evt.model,
    };
    addRunAttrs(spanAttrs, evt);
    assignGenAiModelCallAttrs(spanAttrs, evt);
    if (evt.api) {
      spanAttrs["branch.api"] = evt.api;
    }
    if (evt.transport) {
      spanAttrs["branch.transport"] = evt.transport;
    }
    assignModelCallPromptStatsAttrs(spanAttrs, evt);
    return trackTrustedSpan(
      evt,
      metadata,
      spanWithDuration(modelCallSpanName(evt), spanAttrs, undefined, {
        kind: SpanKind.CLIENT,
        parentContext: activeTrustedParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    ).spanContext();
  };

  const recordModelCallFinished = (
    evt: ModelCallLifecycleDiagnosticEvent,
    metadata: DiagnosticEventMetadata,
    modelContent?: DiagnosticModelCallContent,
  ) => {
    const errorType =
      evt.type === "model.call.error"
        ? normalizeDiagnosticValue(evt.errorCategory, "other")
        : undefined;
    const metricAttrs = {
      ...modelCallMetricAttrs(evt),
      ...(errorType !== undefined ? { "branch.errorCategory": errorType } : {}),
      ...(evt.type === "model.call.error" && evt.failureKind
        ? { "branch.failureKind": normalizeDiagnosticValue(evt.failureKind, "other") }
        : {}),
    };
    modelCallDurationHistogram.record(evt.durationMs, metricAttrs);
    recordModelCallSizeTimingMetrics(evt, metricAttrs);
    genAiOperationDurationHistogram.record(evt.durationMs / 1000, {
      "gen_ai.operation.name": genAiOperationName(evt.api, evt.observationUnit),
      "gen_ai.provider.name": normalizeDiagnosticValue(evt.provider),
      "gen_ai.request.model": normalizeDiagnosticValue(evt.model),
      ...(errorType ? { "error.type": errorType } : {}),
    });
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "branch.provider": evt.provider,
      "branch.model": evt.model,
      ...(errorType !== undefined
        ? { "branch.errorCategory": errorType, "error.type": errorType }
        : {}),
    };
    addRunAttrs(spanAttrs, evt);
    if (evt.type === "model.call.error" && evt.failureKind) {
      spanAttrs["branch.failureKind"] = normalizeDiagnosticValue(evt.failureKind, "other");
    }
    assignGenAiModelCallAttrs(spanAttrs, evt);
    if (evt.api) {
      spanAttrs["branch.api"] = evt.api;
    }
    if (evt.transport) {
      spanAttrs["branch.transport"] = evt.transport;
    }
    assignModelCallSizeTimingAttrs(spanAttrs, evt);
    assignModelCallPromptStatsAttrs(spanAttrs, evt);
    assignModelCallUsageAttrs(spanAttrs, evt);
    assignOtelModelContentAttributes(spanAttrs, modelContent, contentCapturePolicy);
    const span =
      takeTrackedTrustedSpan(evt, metadata) ??
      spanWithDuration(modelCallSpanName(evt), spanAttrs, evt.durationMs, {
        kind: SpanKind.CLIENT,
        parentContext: activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    setSpanAttrs(span, spanAttrs);
    addUpstreamRequestIdSpanEvent(span, evt.upstreamRequestIdHash);
    if (evt.type === "model.call.error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactSensitiveText(evt.errorCategory),
      });
    }
    span.end(evt.ts);
  };

  return {
    recordModelCallStarted,
    recordModelCallFinished,
  };
}
