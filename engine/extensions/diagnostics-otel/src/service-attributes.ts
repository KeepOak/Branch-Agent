import type { LogRecord } from "@opentelemetry/api-logs";
import { normalizeDiagnosticValue } from "branch/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventPayload,
  DiagnosticTraceContext,
} from "branch/plugin-sdk/diagnostic-runtime";
import { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
import {
  BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS,
  DROPPED_OTEL_ATTRIBUTE_KEYS,
  MAX_OTEL_LOG_ATTRIBUTE_COUNT,
  MAX_OTEL_LOG_ATTRIBUTE_VALUE_CHARS,
  OTEL_LOG_ATTRIBUTE_KEY_RE,
  OTEL_LOG_RAW_ATTRIBUTE_KEY_RE,
  SECURITY_TARGET_NAME_VALUE_RE,
} from "./service-constants.js";
import { normalizeOtelLogString } from "./service-content-normalization.js";
import type { SecuritySeverityText } from "./service-types.js";

export function redactOtelAttributes(attributes: Record<string, string | number | boolean>) {
  const redactedAttributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (DROPPED_OTEL_ATTRIBUTE_KEYS.has(key)) {
      continue;
    }
    redactedAttributes[key] = typeof value === "string" ? redactSensitiveText(value) : value;
  }
  return redactedAttributes;
}

function securityTargetNameAttr(value: string | undefined, fallback = "unknown"): string {
  if (!value) {
    return fallback;
  }
  const redacted = redactSensitiveText(value.trim());
  const redactedLower = redacted.toLowerCase();
  if (redactedLower.startsWith("agent:") || redactedLower.includes(":agent:")) {
    return fallback;
  }
  return SECURITY_TARGET_NAME_VALUE_RE.test(redacted) ? redacted : fallback;
}

function otelLogTimestampIso(timestamp: LogRecord["timestamp"]): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  if (Array.isArray(timestamp)) {
    const [seconds, nanoseconds] = timestamp;
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return new Date(seconds * 1000 + Math.trunc(nanoseconds / 1_000_000)).toISOString();
    }
  }
  return new Date().toISOString();
}

export function writeStdoutDiagnosticLogRecord(params: {
  logRecord: LogRecord;
  serviceName: string;
  traceContext?: DiagnosticTraceContext;
}): void {
  const { logRecord, serviceName, traceContext } = params;
  const line = {
    ts: otelLogTimestampIso(logRecord.timestamp),
    signal: "branch.diagnostic.log",
    "service.name": serviceName,
    severityText: logRecord.severityText,
    severityNumber: logRecord.severityNumber,
    body: logRecord.body,
    attributes: logRecord.attributes ?? {},
    ...(traceContext?.traceId ? { trace_id: traceContext.traceId } : {}),
    ...(traceContext?.spanId ? { span_id: traceContext.spanId } : {}),
    ...(traceContext?.traceFlags ? { trace_flags: traceContext.traceFlags } : {}),
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export function assignOtelLogAttribute(
  attributes: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean,
): void {
  if (Object.keys(attributes).length >= MAX_OTEL_LOG_ATTRIBUTE_COUNT) {
    return;
  }
  if (BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS.has(key)) {
    return;
  }
  if (redactSensitiveText(key) !== key) {
    return;
  }
  if (!OTEL_LOG_ATTRIBUTE_KEY_RE.test(key)) {
    return;
  }
  if (typeof value === "string") {
    attributes[key] = normalizeOtelLogString(value, MAX_OTEL_LOG_ATTRIBUTE_VALUE_CHARS);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    attributes[key] = value;
    return;
  }
  if (typeof value === "boolean") {
    attributes[key] = value;
  }
}

function assignOtelEventAttributes(
  attributes: Record<string, string | number | boolean>,
  eventAttributes: Record<string, string | number | boolean> | undefined,
  keyPrefix: string,
  normalizeString?: (value: string) => string,
): void {
  if (!eventAttributes) {
    return;
  }
  for (const [rawKey, value] of Object.entries(eventAttributes)) {
    if (Object.keys(attributes).length >= MAX_OTEL_LOG_ATTRIBUTE_COUNT) {
      break;
    }
    const key = rawKey.trim();
    if (
      BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS.has(key) ||
      redactSensitiveText(key) !== key ||
      !OTEL_LOG_RAW_ATTRIBUTE_KEY_RE.test(key)
    ) {
      continue;
    }
    const normalized =
      typeof value === "string" && normalizeString ? normalizeString(value) : value;
    assignOtelLogAttribute(attributes, `${keyPrefix}${key}`, normalized);
  }
}

export function assignOtelLogEventAttributes(
  attributes: Record<string, string | number | boolean>,
  eventAttributes: Record<string, string | number | boolean> | undefined,
): void {
  assignOtelEventAttributes(attributes, eventAttributes, "branch.");
}

function assignOtelSecurityEventAttributes(
  attributes: Record<string, string | number | boolean>,
  eventAttributes: Record<string, string | number | boolean> | undefined,
): void {
  assignOtelEventAttributes(
    attributes,
    eventAttributes,
    "branch.security.attribute.",
    normalizeDiagnosticValue,
  );
}

export function securitySeverityText(
  severity: Extract<DiagnosticEventPayload, { type: "security.event" }>["severity"],
): SecuritySeverityText {
  switch (severity) {
    case "critical":
      return "FATAL";
    case "high":
      return "ERROR";
    case "medium":
      return "WARN";
    case "info":
    case "low":
      return "INFO";
  }
  const unreachable: never = severity;
  return unreachable;
}

export function assignOtelSecurityAttributes(
  attributes: Record<string, string | number | boolean>,
  evt: Extract<DiagnosticEventPayload, { type: "security.event" }>,
): void {
  const assignOptionalNormalized = (key: string, value: string | undefined) => {
    if (value) {
      assignOtelLogAttribute(attributes, key, normalizeDiagnosticValue(value));
    }
  };
  assignOtelLogAttribute(attributes, "branch.security.event_id", evt.eventId);
  assignOtelLogAttribute(attributes, "branch.security.category", evt.category);
  assignOtelLogAttribute(
    attributes,
    "branch.security.action",
    normalizeDiagnosticValue(evt.action),
  );
  assignOtelLogAttribute(attributes, "branch.security.outcome", evt.outcome);
  assignOtelLogAttribute(attributes, "branch.security.severity", evt.severity);
  assignOptionalNormalized("branch.security.reason", evt.reason);
  if (evt.actor) {
    assignOtelLogAttribute(attributes, "branch.security.actor.kind", evt.actor.kind);
    assignOptionalNormalized("branch.security.actor.id_hash", evt.actor.idHash);
    assignOptionalNormalized("branch.security.actor.device_id_hash", evt.actor.deviceIdHash);
    assignOptionalNormalized("branch.security.actor.channel", evt.actor.channel);
    assignOptionalNormalized("branch.security.actor.role", evt.actor.role);
    if (evt.actor.scopes?.length) {
      assignOtelLogAttribute(
        attributes,
        "branch.security.actor.scopes",
        evt.actor.scopes.map((scope) => normalizeDiagnosticValue(scope)).join(","),
      );
    }
  }
  if (evt.target) {
    assignOtelLogAttribute(attributes, "branch.security.target.kind", evt.target.kind);
    assignOptionalNormalized("branch.security.target.id_hash", evt.target.idHash);
    if (evt.target.name) {
      assignOtelLogAttribute(
        attributes,
        "branch.security.target.name",
        securityTargetNameAttr(evt.target.name),
      );
    }
    assignOptionalNormalized("branch.security.target.owner", evt.target.owner);
  }
  if (evt.policy) {
    assignOptionalNormalized("branch.security.policy.id", evt.policy.id);
    if (evt.policy.decision) {
      assignOtelLogAttribute(attributes, "branch.security.policy.decision", evt.policy.decision);
    }
    assignOptionalNormalized("branch.security.policy.reason", evt.policy.reason);
  }
  if (evt.control) {
    assignOptionalNormalized("branch.security.control.id", evt.control.id);
    if (evt.control.family) {
      assignOtelLogAttribute(attributes, "branch.security.control.family", evt.control.family);
    }
  }
  assignOtelSecurityEventAttributes(attributes, evt.attributes);
}
