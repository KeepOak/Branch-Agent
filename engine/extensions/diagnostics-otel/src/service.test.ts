// Diagnostics Otel tests cover service plugin behavior.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const telemetryState = vi.hoisted(() => {
  type TestSpanContext = {
    traceId: string;
    spanId: string;
    traceFlags: number;
  };
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();
  const spans: Array<{
    name: string;
    addEvent: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    setAttributes: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    spanContext: ReturnType<typeof vi.fn<() => TestSpanContext>>;
  }> = [];
  const tracer = {
    startSpan: vi.fn((name: string, _opts?: unknown, _ctx?: unknown) => {
      const spanNumber = spans.length + 1;
      const spanId = spanNumber.toString(16).padStart(16, "0");
      const span = {
        addEvent: vi.fn(),
        end: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        spanContext: vi.fn<() => TestSpanContext>(() => ({
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId,
          traceFlags: 1,
        })),
      };
      spans.push({ name, ...span });
      return span;
    }),
    setSpanContext: vi.fn((_ctx: unknown, spanContext: unknown) => ({ spanContext })),
  };
  const meter = {
    createCounter: vi.fn((name: string) => {
      const counter = { add: vi.fn() };
      counters.set(name, counter);
      return counter;
    }),
    createHistogram: vi.fn((name: string) => {
      const histogram = { record: vi.fn() };
      histograms.set(name, histogram);
      return histogram;
    }),
  };
  return { counters, histograms, spans, tracer, meter };
});

const traceProviderCtor = vi.hoisted(() => vi.fn());
const traceProviderShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const meterProviderCtor = vi.hoisted(() => vi.fn());
const meterProviderShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const diagWarn = vi.hoisted(() => vi.fn());
const detectResourcesMock = vi.hoisted(() =>
  vi.fn((_options: { detectors?: unknown[] }) => ({
    attributes: { "branch.test.detected": "1" },
    merge: vi.fn((configured: { attributes?: Record<string, unknown> }) => ({
      attributes: {
        "branch.test.detected": "1",
        ...configured.attributes,
      },
    })),
  })),
);
const logEmit = vi.hoisted(() => vi.fn());
const logShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const traceExporterCtor = vi.hoisted(() => vi.fn());
const metricExporterCtor = vi.hoisted(() => vi.fn());
const logExporterCtor = vi.hoisted(() => vi.fn());
const traceExporterExport = vi.hoisted(() => vi.fn());
const metricExporterExport = vi.hoisted(() => vi.fn());
const logExporterExport = vi.hoisted(() => vi.fn());
const traceExporterShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const metricExporterShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const logExporterShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const exporterForceFlush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const logProcessorCtor = vi.hoisted(() => vi.fn());
const spanProcessorCtor = vi.hoisted(() => vi.fn());
const metricReaderCtor = vi.hoisted(() => vi.fn());
const ownedSdkRuntimeCleanup = vi.hoisted(() => vi.fn());
const registerOwnedSdkRuntimeMock = vi.hoisted(() => vi.fn(() => ownedSdkRuntimeCleanup));
const nodeProxyAgent = vi.hoisted(() => ({ kind: "node-proxy-agent" }));
const createNodeProxyAgentMock = vi.hoisted(() => vi.fn());
const unhandledRejectionHandlerState = vi.hoisted(() => {
  let handlers: Array<(reason: unknown) => boolean> = [];
  return {
    getHandlers: () => handlers,
    register: vi.fn((handler: (reason: unknown) => boolean) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    }),
    reset: () => {
      handlers = [];
    },
  };
});

vi.mock("@opentelemetry/api", async (importOriginal) => ({
  createNoopMeter: (await importOriginal<typeof import("@opentelemetry/api")>()).createNoopMeter,
  ROOT_CONTEXT: (await importOriginal<typeof import("@opentelemetry/api")>()).ROOT_CONTEXT,
  context: {
    active: () => ({}),
  },
  diag: {
    warn: diagWarn,
  },
  metrics: {
    getMeter: () => telemetryState.meter,
  },
  isSpanContextValid: () => true,
  trace: {
    getTracer: () => telemetryState.tracer,
    setSpanContext: telemetryState.tracer.setSpanContext,
  },
  TraceFlags: {
    NONE: 0,
    SAMPLED: 1,
  },
  SpanStatusCode: {
    ERROR: 2,
  },
  SpanKind: {
    CLIENT: 2,
  },
}));

vi.mock("./service-propagation.js", () => ({
  registerOwnedSdkRuntime: registerOwnedSdkRuntimeMock,
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-proto", () => ({
  OTLPMetricExporter: function OTLPMetricExporter(options?: unknown) {
    metricExporterCtor(options);
    return {
      export: metricExporterExport,
      forceFlush: exporterForceFlush,
      shutdown: metricExporterShutdown,
    };
  },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: function OTLPTraceExporter(options?: unknown) {
    traceExporterCtor(options);
    return {
      export: traceExporterExport,
      forceFlush: exporterForceFlush,
      shutdown: traceExporterShutdown,
    };
  },
}));

vi.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: function OTLPLogExporter(options?: unknown) {
    logExporterCtor(options);
    return {
      export: logExporterExport,
      forceFlush: exporterForceFlush,
      shutdown: logExporterShutdown,
    };
  },
}));

vi.mock("branch/plugin-sdk/runtime-env", () => ({
  registerUnhandledRejectionHandler: unhandledRejectionHandlerState.register,
}));

vi.mock("branch/plugin-sdk/fetch-runtime", () => ({
  createNodeProxyAgent: createNodeProxyAgentMock,
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: function BatchLogRecordProcessor(options?: unknown) {
    logProcessorCtor(options);
  },
  LoggerProvider: class {
    getLogger = vi.fn(() => ({
      emit: logEmit,
    }));
    shutdown = logShutdown;
  },
}));

vi.mock("@opentelemetry/sdk-metrics", () => ({
  MeterProvider: class {
    constructor(options?: unknown) {
      meterProviderCtor(options);
    }

    getMeter = () => telemetryState.meter;
    shutdown = meterProviderShutdown;
  },
  PeriodicExportingMetricReader: function PeriodicExportingMetricReader(options?: unknown) {
    metricReaderCtor(options);
  },
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BasicTracerProvider: class {
    constructor(options?: unknown) {
      traceProviderCtor(options);
    }

    getTracer = () => telemetryState.tracer;
    shutdown = traceProviderShutdown;
  },
  BatchSpanProcessor: function BatchSpanProcessor(exporter?: unknown, options?: unknown) {
    spanProcessorCtor(exporter, options);
  },
  ParentBasedSampler: function ParentBasedSampler() {},
  TraceIdRatioBasedSampler: function TraceIdRatioBasedSampler() {},
}));

vi.mock("@opentelemetry/resources", () => ({
  detectResources: detectResourcesMock,
  envDetector: { detector: "env" },
  hostDetector: { detector: "host" },
  osDetector: { detector: "os" },
  processDetector: { detector: "process" },
  serviceInstanceIdDetector: { detector: "serviceinstance" },
  resourceFromAttributes: vi.fn((attrs: Record<string, unknown>) => ({
    attributes: attrs,
    merge: vi.fn((other: unknown) => other ?? {}),
  })),
  Resource: function Resource(_value?: unknown) {
    // Constructor shape required by the mocked OpenTelemetry API.
  },
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
}));

import {
  createDiagnosticTraceContext,
  emitTrustedDiagnosticEvent,
  emitTrustedDiagnosticEventWithPrivateData,
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
  waitForDiagnosticEventsDrained,
  type DiagnosticEventPrivateData,
} from "branch/plugin-sdk/diagnostic-runtime";
import {
  emitDiagnosticEventWithTrustedTraceContext,
  emitInternalDiagnosticEventForTest,
  emitTrustedSecurityEvent,
  logMessageDispatchStarted,
  logMessageProcessed,
  runWithDiagnosticTraceContext,
} from "branch/plugin-sdk/plugin-test-runtime";
import { emitDiagnosticEvent, type DiagnosticEventPayload } from "../api.js";
import { MAX_RETAINED_TRUSTED_SPAN_CONTEXTS } from "./service-constants.js";
import {
  createExporterHealthEventEmitter,
  type ExporterHealthUpdate,
} from "./service-exporter-health.js";
import { createDiagnosticsLogExporter } from "./service-logs.js";
import { createDiagnosticsOtelService } from "./service.js";
import {
  CHILD_SPAN_ID,
  createOtelContext,
  createTestTrace,
  getReportedExporterHealth,
  GRANDCHILD_SPAN_ID,
  MODEL_CALL_SPAN_ID,
  MODEL_CALL_FIXTURE,
  MODEL_FIXTURE,
  MODEL_USAGE_SPAN_ID,
  OTEL_TEST_ENDPOINT,
  RUN_FIXTURE,
  SPAN_ID,
  startOtelService,
  stopStartedOtelServices,
  TOOL_SPAN_ID,
  TRACE_ID,
} from "./service.test-helpers.js";

function numberedSpanId(index: number) {
  return (index + 0x1000).toString(16).padStart(16, "0");
}
// Longer than the default 30-minute background exec timeout.
const LATE_CHILD_ELAPSED_MS = 30 * 60_000 + 1_000;
const PROTO_KEY = "__proto__";
const MAX_TEST_OTEL_CONTENT_ATTRIBUTE_CHARS = 128 * 1024;
type TelemetryExporterEvent = Extract<DiagnosticEventPayload, { type: "telemetry.exporter" }>;
const OTEL_TRUNCATED_SUFFIX_MAX_CHARS = 20;
const OTEL_PROTOCOL_ENV_KEYS = [
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
] as const;
const OTEL_PROVIDER_ENV_KEYS = [
  "OTEL_BSP_EXPORT_TIMEOUT",
  "OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
  "OTEL_BSP_MAX_QUEUE_SIZE",
  "OTEL_BSP_SCHEDULE_DELAY",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "OTEL_METRIC_EXPORT_TIMEOUT",
  "OTEL_NODE_EXPERIMENTAL_SDK_METRICS",
  "OTEL_NODE_RESOURCE_DETECTORS",
  "OTEL_SERVICE_NAME",
  "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
  "OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT",
  "OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT",
  "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT",
  "OTEL_SPAN_EVENT_COUNT_LIMIT",
  "OTEL_SPAN_LINK_COUNT_LIMIT",
  "OTEL_TRACES_SAMPLER",
  "OTEL_TRACES_SAMPLER_ARG",
] as const;
const OTEL_CERT_ENV_KEYS = [
  "OTEL_EXPORTER_OTLP_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY",
  "OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_LOGS_CLIENT_CERTIFICATE",
  "OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY",
] as const;
const OTEL_ENV_KEYS = [
  "BRANCH_OTEL_PRELOADED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  "OTEL_SEMCONV_STABILITY_OPT_IN",
  "OTEL_SDK_DISABLED",
  "OTEL_PROPAGATORS",
  ...OTEL_PROTOCOL_ENV_KEYS,
  ...OTEL_PROVIDER_ENV_KEYS,
  ...OTEL_CERT_ENV_KEYS,
];
const originalOtelEnv = new Map(OTEL_ENV_KEYS.map((key) => [key, process.env[key]]));

function startedSpanCall(name: string) {
  const calls = telemetryState.tracer.startSpan.mock.calls as unknown as Array<
    [
      string,
      { attributes?: Record<string, unknown>; kind?: unknown; startTime?: unknown }?,
      unknown?,
    ]
  >;
  return calls.find(([spanName]) => spanName === name);
}

function startedSpanOptions(name: string) {
  return startedSpanCall(name)?.[1];
}

function startedSpanParentContexts(name: string) {
  return telemetryState.tracer.startSpan.mock.calls
    .filter((call) => call[0] === name)
    .map(
      (call) =>
        (call[2] as { spanContext?: { traceId?: string; spanId?: string } } | undefined)
          ?.spanContext,
    );
}

function startedSpanParentContextsByName(name: string) {
  return telemetryState.tracer.startSpan.mock.calls
    .filter((call) => call[0] === name)
    .map((call) => ({
      attributes: (call[1] as { attributes?: Record<string, unknown> } | undefined)?.attributes,
      parentContext: (
        call[2] as { spanContext?: { traceId?: string; spanId?: string } } | undefined
      )?.spanContext,
    }));
}

function mockCall(mock: { mock: { calls: unknown[][] } }, callIndex = 0): unknown[] {
  const call = mock.mock.calls.at(callIndex);
  if (!call) {
    throw new Error(`Expected mock call at index ${callIndex}`);
  }
  return call;
}

function mockCallArg(mock: { mock: { calls: unknown[][] } }, argIndex: number, callIndex = 0) {
  return mockCall(mock, callIndex)[argIndex];
}

type TestExporterOptions = {
  url?: string;
  httpAgentOptions?: (protocol: string) => unknown;
};

function firstExporterOptions(mock: { mock: { calls: unknown[][] } }): TestExporterOptions {
  return mockCallArg(mock, 0) as TestExporterOptions;
}

function createNodeProxyAgentCalls(): Array<{
  mode?: string;
  targetUrl?: string;
  agentOptions?: {
    keepAlive?: boolean;
    ca?: Buffer;
    cert?: Buffer;
    key?: Buffer;
  };
}> {
  return createNodeProxyAgentMock.mock.calls.map(
    ([options]) =>
      options as {
        mode?: string;
        targetUrl?: string;
        agentOptions?: {
          keepAlive?: boolean;
          ca?: Buffer;
          cert?: Buffer;
          key?: Buffer;
        };
      },
  );
}

function findCreateNodeProxyAgentCall(targetUrl: string) {
  const call = createNodeProxyAgentCalls().find((candidate) => candidate.targetUrl === targetUrl);
  if (!call) {
    throw new Error(`Expected createNodeProxyAgent call for ${targetUrl}`);
  }
  return call;
}

type TestSpanProcessorOptions = {
  exportTimeoutMillis?: number;
  maxExportBatchSize?: number;
  maxQueueSize?: number;
  scheduledDelayMillis?: number;
  selfObsMeterProvider?: unknown;
};

function firstSpanProcessorOptions(): TestSpanProcessorOptions {
  return mockCallArg(spanProcessorCtor, 1) as TestSpanProcessorOptions;
}

function firstMetricReaderOptions(): {
  exportIntervalMillis?: number;
  exportTimeoutMillis?: number;
} {
  return mockCallArg(metricReaderCtor, 0) as {
    exportIntervalMillis?: number;
    exportTimeoutMillis?: number;
  };
}

function firstLogProcessorOptions(): { exporter?: unknown; scheduledDelayMillis?: number } {
  return mockCallArg(logProcessorCtor, 0) as {
    exporter?: unknown;
    scheduledDelayMillis?: number;
  };
}

function firstSetSpanContext(): Record<string, unknown> {
  return mockCallArg(telemetryState.tracer.setSpanContext, 1) as Record<string, unknown>;
}

function spanByName(name: string): (typeof telemetryState.spans)[number] {
  const span = telemetryState.spans.find((candidate) => candidate.name === name);
  if (!span) {
    throw new Error(`Expected span ${name}`);
  }
  return span;
}

function firstSpanAttributes(name: string): Record<string, unknown> {
  return mockCallArg(spanByName(name).setAttributes, 0) as Record<string, unknown>;
}

function stringAttribute(attrs: Record<string, unknown> | undefined, key: string): string {
  const value = attrs?.[key];
  expect(value).toEqual(expect.any(String));
  return value as string;
}

function firstSpanEndTime(name: string): unknown {
  return mockCallArg(spanByName(name).end, 0);
}

function firstCounterAddCall(name: string): [unknown, Record<string, unknown>?] {
  const counter = telemetryState.counters.get(name);
  if (!counter) {
    throw new Error(`Expected counter ${name}`);
  }
  return mockCall(counter.add) as [unknown, Record<string, unknown>?];
}

function lastHistogramRecord(name: string) {
  return telemetryState.histograms.get(name)?.record.mock.calls.at(-1) as
    | [unknown, Record<string, unknown>?]
    | undefined;
}

type StdoutDiagnosticLogLine = {
  ts?: string;
  signal?: string;
  "service.name"?: string;
  severityText?: string;
  severityNumber?: number;
  body?: unknown;
  attributes?: Record<string, unknown>;
  trace_id?: string;
  span_id?: string;
  trace_flags?: string;
};

function captureStdoutWrites() {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write);
  return { writes, spy };
}

function parseSingleStdoutDiagnosticLogLine(writes: string[]): StdoutDiagnosticLogLine {
  expect(writes).toHaveLength(1);
  expect(writes[0]?.endsWith("\n")).toBe(true);
  const line = writes[0]?.slice(0, -1) ?? "";
  expect(line).not.toContain("\n");
  return JSON.parse(line) as StdoutDiagnosticLogLine;
}

async function emitAndCaptureLog(
  event: Omit<Extract<Parameters<typeof emitDiagnosticEvent>[0], { type: "log.record" }>, "type">,
) {
  await startOtelService({ logs: true });
  emitDiagnosticEvent({ type: "log.record", ...event });
  await flushDiagnosticEvents();
  expect(logEmit).toHaveBeenCalled();
  return mockCallArg(logEmit, 0) as {
    attributes?: Record<string, unknown>;
    body?: string;
    context?: unknown;
  };
}

function flushDiagnosticEvents() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function emitAndFlush(event: Parameters<typeof emitDiagnosticEvent>[0]) {
  emitDiagnosticEvent(event);
  await flushDiagnosticEvents();
}

async function emitTrustedAndFlush(event: Parameters<typeof emitTrustedDiagnosticEvent>[0]) {
  emitTrustedDiagnosticEvent(event);
  await flushDiagnosticEvents();
}

type TrustedEvent = Parameters<typeof emitTrustedDiagnosticEvent>[0];
type TrustedEventOf<T extends TrustedEvent["type"]> = Extract<TrustedEvent, { type: T }>;
type EventFields<T extends TrustedEvent["type"]> = Omit<TrustedEventOf<T>, "type">;

const EVENT_FIXTURES = {
  "harness.run.completed": {
    ...RUN_FIXTURE,
    harnessId: "branch",
    outcome: "completed",
    durationMs: 90,
    itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
    trace: createTestTrace(GRANDCHILD_SPAN_ID, CHILD_SPAN_ID),
  } satisfies EventFields<"harness.run.completed">,
  "log.record": {
    level: "INFO",
    message: "test log",
  } satisfies EventFields<"log.record">,
  "model.call.completed": {
    ...MODEL_CALL_FIXTURE,
    durationMs: 80,
    trace: createTestTrace(MODEL_CALL_SPAN_ID, CHILD_SPAN_ID),
  } satisfies EventFields<"model.call.completed">,
  "model.call.started": {
    ...MODEL_CALL_FIXTURE,
    trace: createTestTrace(MODEL_CALL_SPAN_ID, CHILD_SPAN_ID),
  } satisfies EventFields<"model.call.started">,
  "model.usage": {
    ...MODEL_FIXTURE,
    usage: { input: 3, output: 2, total: 5 },
    durationMs: 10,
    trace: createTestTrace(GRANDCHILD_SPAN_ID, CHILD_SPAN_ID),
  } satisfies EventFields<"model.usage">,
  "run.completed": {
    ...RUN_FIXTURE,
    outcome: "completed",
    durationMs: 100,
    trace: createTestTrace(CHILD_SPAN_ID, SPAN_ID),
  } satisfies EventFields<"run.completed">,
  "run.started": {
    ...RUN_FIXTURE,
    trace: createTestTrace(CHILD_SPAN_ID, SPAN_ID),
  } satisfies EventFields<"run.started">,
  "tool.execution.completed": {
    runId: "run-1",
    toolName: "read",
    durationMs: 20,
    trace: createTestTrace(TOOL_SPAN_ID, GRANDCHILD_SPAN_ID),
  } satisfies EventFields<"tool.execution.completed">,
  "tool.execution.error": {
    runId: "run-1",
    toolName: "read",
    durationMs: 20,
    errorCategory: "TypeError",
    trace: createTestTrace(TOOL_SPAN_ID, GRANDCHILD_SPAN_ID),
  } satisfies EventFields<"tool.execution.error">,
  "tool.execution.started": {
    runId: "run-1",
    toolName: "read",
    trace: createTestTrace(TOOL_SPAN_ID, GRANDCHILD_SPAN_ID),
  } satisfies EventFields<"tool.execution.started">,
};

type FixtureEventType = keyof typeof EVENT_FIXTURES;

function buildEventFixture(
  type: TrustedEvent["type"],
  overrides: Record<string, unknown> = {},
  omitted: readonly string[] = [],
): TrustedEvent {
  const defaults = EVENT_FIXTURES[type as FixtureEventType];
  const event = { ...defaults, type, ...overrides } as Record<string, unknown>;
  for (const key of omitted) {
    delete event[key];
  }
  return event as TrustedEvent;
}

function eventFixture<T extends FixtureEventType>(
  type: T,
  overrides?: Partial<EventFields<T>>,
  omitted?: readonly (keyof EventFields<T>)[],
): TrustedEventOf<T>;
function eventFixture<T extends TrustedEvent["type"]>(
  type: T,
  event: EventFields<T>,
  omitted?: readonly (keyof EventFields<T>)[],
): TrustedEventOf<T>;
function eventFixture(
  type: TrustedEvent["type"],
  overrides: Record<string, unknown> = {},
  omitted: readonly string[] = [],
): TrustedEvent {
  return buildEventFixture(type, overrides, omitted);
}

type FixtureEmitter<TResult> = {
  <T extends FixtureEventType>(
    type: T,
    overrides?: Partial<EventFields<T>>,
    omitted?: readonly (keyof EventFields<T>)[],
  ): TResult;
  <T extends TrustedEvent["type"]>(
    type: T,
    event: EventFields<T>,
    omitted?: readonly (keyof EventFields<T>)[],
  ): TResult;
};

function createFixtureEmitter<TResult>(
  emit: (event: TrustedEvent) => TResult,
): FixtureEmitter<TResult> {
  return ((
    type: TrustedEvent["type"],
    overrides?: Record<string, unknown>,
    omitted?: readonly string[],
  ) => emit(buildEventFixture(type, overrides, omitted))) as FixtureEmitter<TResult>;
}

const emitEvent = createFixtureEmitter(emitDiagnosticEvent);
const emitEventAndFlush = createFixtureEmitter(emitAndFlush);
const emitTrustedEvent = createFixtureEmitter(emitTrustedDiagnosticEvent);
const emitTrustedEventAndFlush = createFixtureEmitter(emitTrustedAndFlush);
const emitInternalEvent = createFixtureEmitter(emitInternalDiagnosticEventForTest);

type OtelServiceOptions = NonNullable<Parameters<typeof startOtelService>[0]>;
type OtelSignal = "traces" | "metrics" | "logs";
const omitConfiguredProtocol: NonNullable<OtelServiceOptions["configure"]> = (ctx) => {
  delete ctx.config.diagnostics?.otel?.protocol;
};

function startServiceFixture(
  signals: readonly OtelSignal[],
  optionsOrConfigure:
    | Omit<OtelServiceOptions, OtelSignal>
    | NonNullable<OtelServiceOptions["configure"]> = {},
) {
  const options =
    typeof optionsOrConfigure === "function"
      ? { configure: optionsOrConfigure }
      : optionsOrConfigure;
  return startOtelService({
    traces: signals.includes("traces"),
    metrics: signals.includes("metrics"),
    logs: signals.includes("logs"),
    ...options,
  });
}

function captureExporterEvents() {
  const events: TelemetryExporterEvent[] = [];
  const unsubscribe = onInternalDiagnosticEvent((event) => {
    if (event.type === "telemetry.exporter") {
      events.push(event);
    }
  });
  return { events, unsubscribe };
}

function emitTrustedModelCallCompletedWithContent(
  modelContent: NonNullable<DiagnosticEventPrivateData["modelContent"]>,
  overrides: Partial<EventFields<"model.call.completed">> = {},
) {
  emitTrustedDiagnosticEventWithPrivateData(
    {
      type: "model.call.completed",
      ...MODEL_CALL_FIXTURE,
      durationMs: 80,
      ...overrides,
    },
    { modelContent },
  );
}

async function captureModelContent(
  ...args: Parameters<typeof emitTrustedModelCallCompletedWithContent>
) {
  await startServiceFixture(["traces"], { captureContent: true });
  emitTrustedModelCallCompletedWithContent(...args);
  await flushDiagnosticEvents();
  return firstSpanAttributes("branch.model.call");
}

function emitTrustedToolExecutionCompletedWithContent(
  toolContent: NonNullable<DiagnosticEventPrivateData["toolContent"]>,
  overrides: Partial<EventFields<"tool.execution.completed">> = {},
) {
  emitTrustedDiagnosticEventWithPrivateData(
    {
      type: "tool.execution.completed",
      runId: "run-1",
      toolName: "read",
      durationMs: 20,
      ...overrides,
    },
    { toolContent },
  );
}

afterAll(() => {
  vi.doUnmock("@opentelemetry/api");
  vi.doUnmock("@opentelemetry/exporter-metrics-otlp-proto");
  vi.doUnmock("@opentelemetry/exporter-trace-otlp-proto");
  vi.doUnmock("@opentelemetry/exporter-logs-otlp-proto");
  vi.doUnmock("@opentelemetry/sdk-logs");
  vi.doUnmock("@opentelemetry/sdk-metrics");
  vi.doUnmock("@opentelemetry/sdk-trace-base");
  vi.doUnmock("branch/plugin-sdk/fetch-runtime");
  vi.doUnmock("@opentelemetry/resources");
  vi.doUnmock("@opentelemetry/semantic-conventions");
  vi.resetModules();
});

describe("diagnostics-otel service", () => {
  beforeEach(() => {
    resetDiagnosticEventsForTest();
    for (const key of OTEL_ENV_KEYS) {
      delete process.env[key];
    }
    telemetryState.counters.clear();
    telemetryState.histograms.clear();
    telemetryState.spans.length = 0;
    telemetryState.tracer.startSpan.mockClear();
    telemetryState.tracer.setSpanContext.mockClear();
    telemetryState.meter.createCounter.mockClear();
    telemetryState.meter.createHistogram.mockClear();
    traceProviderCtor.mockClear();
    traceProviderShutdown.mockClear();
    meterProviderCtor.mockClear();
    meterProviderShutdown.mockClear();
    diagWarn.mockClear();
    logEmit.mockReset();
    logShutdown.mockClear();
    traceExporterCtor.mockClear();
    metricExporterCtor.mockClear();
    logExporterCtor.mockClear();
    traceExporterExport.mockReset();
    metricExporterExport.mockReset();
    logExporterExport.mockReset();
    traceExporterShutdown.mockReset();
    traceExporterShutdown.mockResolvedValue(undefined);
    metricExporterShutdown.mockReset();
    metricExporterShutdown.mockResolvedValue(undefined);
    logExporterShutdown.mockReset();
    logExporterShutdown.mockResolvedValue(undefined);
    exporterForceFlush.mockReset();
    exporterForceFlush.mockResolvedValue(undefined);
    logProcessorCtor.mockClear();
    spanProcessorCtor.mockClear();
    metricReaderCtor.mockClear();
    ownedSdkRuntimeCleanup.mockClear();
    registerOwnedSdkRuntimeMock.mockClear();
    registerOwnedSdkRuntimeMock.mockReturnValue(ownedSdkRuntimeCleanup);
    createNodeProxyAgentMock.mockReset();
    createNodeProxyAgentMock.mockReturnValue(undefined);
    unhandledRejectionHandlerState.reset();
    unhandledRejectionHandlerState.register.mockClear();
  });

  afterEach(async () => {
    await stopStartedOtelServices();
    resetDiagnosticEventsForTest();
    for (const [key, value] of originalOtelEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("drops camelCase and snake_case diagnostic id log attributes before export", async () => {
    const emitCall = await emitAndCaptureLog({
      level: "INFO",
      message: "diagnostic id attributes",
      attributes: {
        callId: "call-camel",
        call_id: "call-snake",
        chatId: "chat-camel",
        chat_id: "chat-snake",
        messageId: "message-camel",
        message_id: "message-snake",
        parentSpanId: "parent-camel",
        parent_span_id: "parent-snake",
        runId: "run-camel",
        run_id: "run-snake",
        sessionId: "session-camel",
        session_id: "session-snake",
        sessionKey: "session-key-camel",
        session_key: "session-key-snake",
        spanId: "span-camel",
        span_id: "span-snake",
        toolCallId: "tool-camel",
        tool_call_id: "tool-snake",
        traceId: "trace-camel",
        trace_id: "trace-snake",
        provider: "openai",
      },
    });

    expect(emitCall.attributes?.["branch.provider"]).toBe("openai");
    for (const key of [
      "branch.callId",
      "branch.call_id",
      "branch.chatId",
      "branch.chat_id",
      "branch.messageId",
      "branch.message_id",
      "branch.parentSpanId",
      "branch.parent_span_id",
      "branch.runId",
      "branch.run_id",
      "branch.sessionId",
      "branch.session_id",
      "branch.sessionKey",
      "branch.session_key",
      "branch.spanId",
      "branch.span_id",
      "branch.toolCallId",
      "branch.tool_call_id",
      "branch.traceId",
      "branch.trace_id",
    ]) {
      expect(Object.hasOwn(emitCall.attributes ?? {}, key)).toBe(false);
    }
  });

  test("records message-flow metrics and spans", async () => {
    await startServiceFixture(["traces", "metrics", "logs"]);

    emitEvent("webhook.received", {
      channel: "telegram",
      updateType: "telegram-post",
    });
    emitEvent("webhook.processed", {
      channel: "telegram",
      updateType: "telegram-post",
      chatId: "chat-should-not-export",
      durationMs: 120,
    });
    emitEvent("message.queued", {
      channel: "telegram",
      source: "telegram",
      queueDepth: 2,
    });
    emitEvent("message.received", {
      channel: "telegram",
      source: "webhook",
    });
    emitEvent("message.dispatch.started", {
      channel: "telegram",
      source: "webhook",
    });
    emitEvent("message.dispatch.completed", {
      channel: "telegram",
      source: "webhook",
      durationMs: 25,
      outcome: "completed",
    });
    emitEvent("message.received", {
      channel: "telegram/custom",
      source: "webhook with secret sk-test",
    });
    emitEvent("message.dispatch.started", {
      channel: "telegram/custom",
      source: "webhook with secret sk-test",
    });
    emitEvent("message.dispatch.completed", {
      channel: "telegram/custom",
      source: "webhook with secret sk-test",
      durationMs: 30,
      outcome: "completed",
      reason: "progress draft / message tool 123",
    });
    emitEvent("message.processed", {
      channel: "telegram",
      chatId: "chat-should-not-export",
      messageId: "message-should-not-export",
      outcome: "completed",
      reason: "progress draft / message tool 123",
      durationMs: 55,
    });
    emitEvent("queue.lane.dequeue", {
      lane: "main",
      queueSize: 3,
      waitMs: 10,
    });
    emitEvent("session.stuck", {
      state: "processing",
      ageMs: 125_000,
      classification: "stale_session_state",
    });
    emitEvent("run.attempt", {
      runId: "run-1",
      attempt: 2,
    });

    expect(telemetryState.counters.get("branch.webhook.received")?.add).toHaveBeenCalledWith(1, {
      "branch.channel": "telegram",
      "branch.webhook": "telegram-post",
    });
    expect(
      telemetryState.histograms.get("branch.webhook.duration_ms")?.record,
    ).toHaveBeenCalledWith(120, {
      "branch.channel": "telegram",
      "branch.webhook": "telegram-post",
    });
    expect(telemetryState.counters.get("branch.message.queued")?.add).toHaveBeenCalledWith(1, {
      "branch.channel": "telegram",
      "branch.source": "telegram",
    });
    expect(telemetryState.histograms.get("branch.queue.depth")?.record).toHaveBeenCalledTimes(2);
    expect(telemetryState.histograms.get("branch.queue.depth")?.record).toHaveBeenCalledWith(2, {
      "branch.channel": "telegram",
      "branch.source": "telegram",
    });
    expect(telemetryState.histograms.get("branch.queue.depth")?.record).toHaveBeenCalledWith(3, {
      "branch.lane": "main",
    });
    expect(telemetryState.counters.get("branch.message.processed")?.add).toHaveBeenCalledWith(1, {
      "branch.channel": "telegram",
      "branch.outcome": "completed",
    });
    expect(telemetryState.counters.get("branch.message.received")?.add).toHaveBeenCalledWith(1, {
      "branch.channel": "telegram",
      "branch.source": "webhook",
    });
    expect(telemetryState.counters.get("branch.message.received")?.add).toHaveBeenCalledWith(1, {
      "branch.channel": "unknown",
      "branch.source": "unknown",
    });
    expect(
      telemetryState.counters.get("branch.message.dispatch.started")?.add,
    ).toHaveBeenCalledWith(1, {
      "branch.channel": "telegram",
      "branch.source": "webhook",
    });
    expect(
      telemetryState.counters.get("branch.message.dispatch.started")?.add,
    ).toHaveBeenCalledWith(1, {
      "branch.channel": "unknown",
      "branch.source": "unknown",
    });
    expect(
      telemetryState.counters.get("branch.message.dispatch.completed")?.add,
    ).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        "branch.channel": "telegram",
        "branch.outcome": "completed",
        "branch.source": "webhook",
      }),
    );
    expect(
      telemetryState.counters.get("branch.message.dispatch.completed")?.add,
    ).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        "branch.channel": "unknown",
        "branch.reason": "none",
        "branch.source": "unknown",
      }),
    );
    expect(
      telemetryState.histograms.get("branch.message.dispatch.duration_ms")?.record,
    ).toHaveBeenCalledWith(
      25,
      expect.objectContaining({
        "branch.channel": "telegram",
        "branch.outcome": "completed",
        "branch.source": "webhook",
      }),
    );
    expect(
      telemetryState.histograms.get("branch.message.dispatch.duration_ms")?.record,
    ).toHaveBeenCalledWith(
      30,
      expect.objectContaining({
        "branch.channel": "unknown",
        "branch.reason": "none",
        "branch.source": "unknown",
      }),
    );
    expect(
      telemetryState.histograms.get("branch.message.duration_ms")?.record,
    ).toHaveBeenCalledWith(55, {
      "branch.channel": "telegram",
      "branch.outcome": "completed",
    });
    expect(telemetryState.histograms.get("branch.queue.wait_ms")?.record).toHaveBeenCalledWith(
      10,
      {
        "branch.lane": "main",
      },
    );
    expect(telemetryState.counters.get("branch.session.stuck")?.add).toHaveBeenCalledTimes(1);
    expect(telemetryState.counters.get("branch.session.stuck")?.add).toHaveBeenCalledWith(1, {
      "branch.state": "processing",
    });
    expect(
      telemetryState.histograms.get("branch.session.stuck_age_ms")?.record,
    ).toHaveBeenCalledWith(125_000, {
      "branch.state": "processing",
    });
    expect(telemetryState.counters.get("branch.run.attempt")?.add).toHaveBeenCalledWith(1, {
      "branch.attempt": 2,
    });

    emitEvent("session.turn.created", {
      runId: "run-1",
      agentId: "agent.default",
      channel: "telegram",
      trigger: "user",
    });
    expect(telemetryState.counters.get("branch.session.turn.created")?.add).toHaveBeenCalledWith(
      1,
      {
        "branch.agent": "agent.default",
        "branch.channel": "telegram",
        "branch.trigger": "user",
      },
    );

    const spanNames = telemetryState.tracer.startSpan.mock.calls.map((call) => call[0]);
    expect(spanNames).toContain("branch.webhook.processed");
    expect(spanNames).toContain("branch.message.processed");
    expect(spanNames).toContain("branch.session.stuck");
    const webhookSpanOptions = startedSpanOptions("branch.webhook.processed");
    expect(webhookSpanOptions?.attributes).not.toHaveProperty("branch.chatId");
    expect(webhookSpanOptions?.startTime).toBeTypeOf("number");
    const messageSpanOptions = startedSpanOptions("branch.message.processed");
    expect(messageSpanOptions?.attributes).toMatchObject({
      "branch.channel": "telegram",
      "branch.outcome": "completed",
      "branch.reason": "unknown",
    });
    expect(messageSpanOptions?.attributes).not.toHaveProperty("branch.chatId");
    expect(messageSpanOptions?.attributes).not.toHaveProperty("branch.messageId");
    expect(messageSpanOptions?.startTime).toBeTypeOf("number");

    await emitEventAndFlush("log.record", {
      message: "hello",
      attributes: { subsystem: "diagnostic" },
    });
    expect(logEmit).toHaveBeenCalled();
  });

  test("surfaces bridge cleanup failure after attempting every shutdown phase", async () => {
    const cleanupError = new Error("bridge cleanup failed");
    const unregisterBridge = vi.fn(() => {
      throw cleanupError;
    });
    const cleanupOrder: string[] = [];
    logShutdown.mockImplementationOnce(async () => {
      cleanupOrder.push("log-provider");
    });
    traceProviderShutdown.mockImplementationOnce(async () => {
      cleanupOrder.push("trace-provider");
    });
    meterProviderShutdown.mockImplementationOnce(async () => {
      cleanupOrder.push("meter-provider");
    });
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, {
      traces: true,
      metrics: true,
      logs: true,
    });
    const onEvent = ctx.internalDiagnostics!.onEvent;
    ctx.internalDiagnostics = {
      ...ctx.internalDiagnostics!,
      onEvent: (listener) => {
        const unsubscribe = onEvent(listener);
        return () => {
          cleanupOrder.push("listener");
          unsubscribe();
        };
      },
      registerTracePropagationBridge: () => () => {
        cleanupOrder.push("bridge");
        unregisterBridge();
      },
    };
    await service.start(ctx);
    emitTrustedEvent("run.started");
    const runSpan = spanByName("branch.run");

    const stopError = await Promise.resolve(service.stop?.(ctx)).catch((error: unknown) => error);

    expect(stopError).toBe(cleanupError);
    expect(unregisterBridge).toHaveBeenCalledOnce();
    expect(runSpan.end).toHaveBeenCalledOnce();
    expect(logShutdown).toHaveBeenCalledOnce();
    expect(traceProviderShutdown).toHaveBeenCalledOnce();
    expect(meterProviderShutdown).toHaveBeenCalledOnce();
    expect(unhandledRejectionHandlerState.getHandlers()).toEqual([]);
    expect(cleanupOrder.indexOf("bridge")).toBeLessThan(cleanupOrder.indexOf("log-provider"));
    expect(cleanupOrder.indexOf("listener")).toBeLessThan(cleanupOrder.indexOf("trace-provider"));
  });

  test("attempts every provider shutdown and reports every failure", async () => {
    const logError = new Error("log provider failed");
    const traceError = new Error("trace provider failed");
    const meterError = new Error("meter provider failed");
    logShutdown.mockRejectedValueOnce(logError);
    traceProviderShutdown.mockRejectedValueOnce(traceError);
    meterProviderShutdown.mockRejectedValueOnce(meterError);
    const { service, ctx } = await startServiceFixture(["traces", "metrics", "logs"]);

    const stopError = await Promise.resolve(service.stop?.(ctx)).catch((error: unknown) => error);

    expect(logShutdown).toHaveBeenCalledTimes(1);
    expect(traceProviderShutdown).toHaveBeenCalledTimes(1);
    expect(meterProviderShutdown).toHaveBeenCalledTimes(1);
    expect(stopError).toBeInstanceOf(AggregateError);
    expect(stopError).toMatchObject({
      errors: [logError, traceError, meterError],
      message: expect.stringContaining("log provider failed"),
    });
    expect(stopError).toMatchObject({
      message: expect.stringContaining("trace provider failed"),
    });
    expect(stopError).toMatchObject({
      message: expect.stringContaining("meter provider failed"),
    });
  });

  test("retires an exporter failure retained after shutdown rejects", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    const { service, ctx } = await startServiceFixture(["traces"]);
    traceExporterShutdown.mockRejectedValueOnce(new TypeError("private shutdown details"));
    traceProviderShutdown.mockImplementationOnce(async () => {
      // Emulate the real provider shutdown chain: the exporter health wrapper
      // observes the failing exporter shutdown before the provider failure is
      // reported, so the shutdown_failed route is retained, not dropped.
      const exporter = spanProcessorCtor.mock.calls.at(-1)?.[0] as
        | { shutdown(): Promise<void> }
        | undefined;
      if (!exporter) {
        throw new Error("expected trace exporter");
      }
      await exporter.shutdown();
    });

    await expect(service.stop?.(ctx)).rejects.toThrow("private shutdown details");
    await waitForDiagnosticEventsDrained();
    expect(events.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: "started", reason: "configured" },
      { status: "failure", reason: "shutdown_failed" },
    ]);
    expect(
      getReportedExporterHealth(ctx).map(({ transport, status, reason }) => ({
        transport,
        status,
        reason,
      })),
    ).toEqual([
      {
        transport: "otlp-http-protobuf",
        status: "started",
        reason: "configured",
      },
      {
        transport: "otlp-http-protobuf",
        status: "failure",
        reason: "shutdown_failed",
      },
    ]);

    await expect(service.stop?.(ctx)).resolves.toBeUndefined();
    await waitForDiagnosticEventsDrained();
    expect(events.at(-1)).toMatchObject({ status: "dropped" });
    expect(getReportedExporterHealth(ctx).at(-1)).toMatchObject({
      transport: "otlp-http-protobuf",
      status: "dropped",
    });
    expect(JSON.stringify({ events, health: getReportedExporterHealth(ctx) })).not.toContain(
      "private shutdown details",
    );
    unsubscribe();
  });

  test("preserves SDK startup failure through host rollback when shutdown also fails", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    const startupError = new Error("SDK startup failed");
    const rollbackError = new Error("SDK rollback failed");
    traceProviderCtor.mockImplementationOnce(() => {
      throw startupError;
    });
    meterProviderShutdown.mockRejectedValueOnce(rollbackError);
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { traces: true, metrics: true });

    const startError = await Promise.resolve(service.start(ctx)).catch((error: unknown) => error);

    expect(startError).toBeInstanceOf(AggregateError);
    expect(startError).toMatchObject({
      message: "diagnostics-otel startup failed and rollback cleanup failed",
      cause: startupError,
      errors: [startupError, rollbackError],
    });
    expect(ctx.logger.error).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("diagnostics-otel: failed to start SDK: Error: SDK startup failed"),
    );
    expect(ctx.logger.error).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "diagnostics-otel: SDK startup rollback cleanup failed: Error: SDK rollback failed",
      ),
    );
    expect(meterProviderShutdown).toHaveBeenCalledOnce();
    await waitForDiagnosticEventsDrained();
    expect(events.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: "failure", reason: "start_failed" },
      { status: "failure", reason: "start_failed" },
    ]);
    expect(
      getReportedExporterHealth(ctx).map(({ signal, transport, endpointMode, status, reason }) => ({
        signal,
        transport,
        endpointMode,
        status,
        reason,
      })),
    ).toEqual([
      {
        signal: "traces",
        transport: "otlp-http-protobuf",
        endpointMode: "configured",
        status: "failure",
        reason: "start_failed",
      },
      {
        signal: "metrics",
        transport: "otlp-http-protobuf",
        endpointMode: "configured",
        status: "failure",
        reason: "start_failed",
      },
    ]);
    await expect(service.stop?.(ctx)).resolves.toBeUndefined();
    await waitForDiagnosticEventsDrained();
    expect(events.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: "failure", reason: "start_failed" },
      { status: "failure", reason: "start_failed" },
    ]);
    expect(getReportedExporterHealth(ctx).at(-1)).toMatchObject({
      transport: "otlp-http-protobuf",
      status: "failure",
      reason: "start_failed",
    });

    await expect(service.stop?.(ctx)).resolves.toBeUndefined();
    await waitForDiagnosticEventsDrained();
    expect(events.at(-1)).toMatchObject({ status: "dropped" });
    expect(getReportedExporterHealth(ctx).at(-1)).toMatchObject({
      transport: "otlp-http-protobuf",
      status: "dropped",
    });
    unsubscribe();
  });

  test.each([
    {
      label: "dependency-default",
      endpoint: undefined,
      endpointMode: "default_endpoint" as const,
    },
  ])(
    "records $label endpoint ownership when SDK startup fails",
    async ({ endpoint, endpointMode }) => {
      const events: TelemetryExporterEvent[] = [];
      const unsubscribe = onInternalDiagnosticEvent((event) => {
        if (event.type === "telemetry.exporter") {
          events.push(event);
        }
      });
      traceProviderCtor.mockImplementationOnce(() => {
        throw new TypeError("private startup details");
      });
      const service = createDiagnosticsOtelService();
      const ctx = createOtelContext(endpoint ?? "", {
        traces: true,
        metrics: false,
        logs: false,
      });
      if (endpoint === undefined) {
        delete ctx.config.diagnostics?.otel?.endpoint;
      }

      await expect(service.start(ctx)).rejects.toThrow("private startup details");
      await waitForDiagnosticEventsDrained();

      expect(events.map(({ signal, status, reason }) => ({ signal, status, reason }))).toEqual([
        {
          signal: "traces",
          status: "failure",
          reason: "start_failed",
        },
      ]);
      expect(
        getReportedExporterHealth(ctx).map(
          ({ signal, transport, endpointMode: eventMode, status, reason }) => ({
            signal,
            transport,
            endpointMode: eventMode,
            status,
            reason,
          }),
        ),
      ).toEqual([
        {
          signal: "traces",
          transport: "otlp-http-protobuf",
          endpointMode,
          status: "failure",
          reason: "start_failed",
        },
      ]);
      expect(JSON.stringify({ events, health: getReportedExporterHealth(ctx) })).not.toContain(
        OTEL_TEST_ENDPOINT,
      );
      expect(JSON.stringify({ events, health: getReportedExporterHealth(ctx) })).not.toContain(
        "private startup details",
      );

      await service.stop?.(ctx);
      await service.stop?.(ctx);
      unsubscribe();
    },
  );

  test("registers and removes an OTLP exporter unhandled rejection handler", async () => {
    const { service, ctx } = await startServiceFixture(["traces", "metrics", "logs"]);

    expect(unhandledRejectionHandlerState.register).toHaveBeenCalledTimes(1);
    const handler = unhandledRejectionHandlerState.getHandlers()[0];
    expect(handler).toBeTypeOf("function");

    const errorInstance = Object.assign(new Error("collector gone"), {
      name: "OTLPExporterError",
      code: 410,
    });
    expect(handler?.(errorInstance)).toBe(true);
    expect(handler?.({ name: "OTLPExporterError", code: 410, data: "user_stop" })).toBe(true);
    expect(handler?.([{ name: "OTLPExporterError", code: 410, data: "user_stop" }])).toBe(true);
    expect(
      handler?.(
        new AggregateError(
          [{ name: "OTLPExporterError", code: 410, data: "user_stop" }],
          "export failed",
        ),
      ),
    ).toBe(true);
    expect(handler?.(new Error("other exporter error"))).toBe(false);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "diagnostics-otel: suppressed OTLP exporter unhandled rejection (code=410)",
    );

    await service.stop?.(ctx);
    expect(unhandledRejectionHandlerState.getHandlers()).toHaveLength(0);
  });

  test("cleans up existing providers and does not reinitialize without capability", async () => {
    const service = createDiagnosticsOtelService();
    const enabledCtx = createOtelContext(OTEL_TEST_ENDPOINT, {
      traces: true,
      metrics: true,
      logs: true,
    });
    await service.start(enabledCtx);

    traceProviderCtor.mockClear();
    meterProviderCtor.mockClear();
    logExporterCtor.mockClear();
    const deniedCtx = createOtelContext(OTEL_TEST_ENDPOINT, {
      traces: true,
      metrics: true,
      logs: true,
    });
    delete deniedCtx.internalDiagnostics;

    await service.start(deniedCtx);
    await service.stop?.(deniedCtx);

    expect(deniedCtx.logger.error).toHaveBeenCalledWith(
      "diagnostics-otel: internal diagnostics capability unavailable",
    );
    expect(traceProviderCtor).not.toHaveBeenCalled();
    expect(meterProviderCtor).not.toHaveBeenCalled();
    expect(logExporterCtor).not.toHaveBeenCalled();
    expect(traceProviderShutdown).toHaveBeenCalledOnce();
    expect(meterProviderShutdown).toHaveBeenCalledOnce();
    expect(logShutdown).toHaveBeenCalledOnce();
  });

  test("warns through the plugin logger and keeps the SDK enabled for an invalid value", async () => {
    process.env.OTEL_SDK_DISABLED = "invalid";

    const { service, ctx } = await startServiceFixture(["traces", "metrics", "logs"]);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "diagnostics-otel: invalid OTEL_SDK_DISABLED value; expected true or false, using false",
    );
    expect(traceProviderCtor).toHaveBeenCalledOnce();
    expect(meterProviderCtor).toHaveBeenCalledOnce();
    expect(traceExporterCtor).toHaveBeenCalledOnce();
    expect(metricExporterCtor).toHaveBeenCalledOnce();
    expect(logExporterCtor).toHaveBeenCalledOnce();
    expect(registerOwnedSdkRuntimeMock).toHaveBeenCalledOnce();

    await service.stop?.(ctx);
  });

  test("skips malformed endpoint, protocol, and TLS settings while disabled", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    process.env.OTEL_SDK_DISABLED = "true";
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "grpc";
    process.env.OTEL_EXPORTER_OTLP_CERTIFICATE = "/definitely-missing/otel-root.pem";
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext("not a collector URL", {
      traces: true,
      metrics: true,
      logs: true,
      logsExporter: "both",
    });

    await expect(service.start(ctx)).resolves.toBeUndefined();
    await waitForDiagnosticEventsDrained();

    expect(events).toEqual([]);
    expect(getReportedExporterHealth(ctx)).toEqual([]);
    expect(traceExporterCtor).not.toHaveBeenCalled();
    expect(metricExporterCtor).not.toHaveBeenCalled();
    expect(logExporterCtor).not.toHaveBeenCalled();
    expect(createNodeProxyAgentMock).not.toHaveBeenCalled();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
    await service.stop?.(ctx);
    unsubscribe();
  });

  test("preserves preloaded trace and metric ownership while disabling plugin logs", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    process.env.BRANCH_OTEL_PRELOADED = "1";
    process.env.OTEL_SDK_DISABLED = "true";

    const { service, ctx } = await startServiceFixture(["traces", "metrics", "logs"], {
      logsExporter: "both",
    });
    emitEvent("run.completed", {}, ["trace"]);
    await emitEventAndFlush("log.record", {
      message: "disabled preloaded log",
    });
    await waitForDiagnosticEventsDrained();

    expect(events.map(({ signal, status }) => ({ signal, status }))).toEqual([
      { signal: "traces", status: "started" },
      { signal: "metrics", status: "started" },
    ]);
    expect(
      getReportedExporterHealth(ctx).map(({ signal, transport, status }) => ({
        signal,
        transport,
        status,
      })),
    ).toEqual([
      {
        signal: "traces",
        transport: "external-sdk",
        status: "started",
      },
      {
        signal: "metrics",
        transport: "external-sdk",
        status: "started",
      },
    ]);
    expect(traceExporterCtor).not.toHaveBeenCalled();
    expect(metricExporterCtor).not.toHaveBeenCalled();
    expect(logExporterCtor).not.toHaveBeenCalled();
    expect(traceProviderCtor).not.toHaveBeenCalled();
    expect(meterProviderCtor).not.toHaveBeenCalled();
    expect(unhandledRejectionHandlerState.register).not.toHaveBeenCalled();
    expect(lastHistogramRecord("branch.run.duration_ms")?.[0]).toBe(100);
    expect(startedSpanOptions("branch.run")?.attributes?.["branch.outcome"]).toBe("completed");
    expect(logEmit).not.toHaveBeenCalled();
    expect(registerOwnedSdkRuntimeMock).not.toHaveBeenCalled();
    await service.stop?.(ctx);
    unsubscribe();
  });

  test("retires unsupported OTLP failures on disabled restart and stop", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, { traces: true });
    delete ctx.config.diagnostics!.otel!.protocol;
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "grpc";

    try {
      await service.start(ctx);
      ctx.config.diagnostics!.enabled = false;
      await service.start(ctx);
      ctx.config.diagnostics!.enabled = true;
      await service.start(ctx);
      await service.stop?.(ctx);
      await waitForDiagnosticEventsDrained();

      expect(
        getReportedExporterHealth(ctx).map(({ transport, status, reason }) => ({
          transport,
          status,
          reason,
        })),
      ).toEqual([
        {
          transport: "otlp-http-protobuf",
          status: "failure",
          reason: "unsupported_protocol",
        },
        { transport: "otlp-http-protobuf", status: "dropped", reason: undefined },
        {
          transport: "otlp-http-protobuf",
          status: "failure",
          reason: "unsupported_protocol",
        },
        { transport: "otlp-http-protobuf", status: "dropped", reason: undefined },
      ]);
    } finally {
      await service.stop?.(ctx);
    }
  });

  test("rebuilds the current log route set while preserving logs both", async () => {
    const service = createDiagnosticsOtelService();
    const ctx = createOtelContext(OTEL_TEST_ENDPOINT, {
      logs: true,
      logsExporter: "both",
    });

    try {
      await service.start(ctx);
      ctx.config.diagnostics!.otel!.logsExporter = "stdout";
      await service.start(ctx);
      ctx.config.diagnostics!.otel!.logsExporter = "both";
      await service.start(ctx);
      await waitForDiagnosticEventsDrained();

      expect(
        getReportedExporterHealth(ctx).map(({ transport, status }) => ({
          transport,
          status,
        })),
      ).toEqual([
        { transport: "otlp-http-protobuf", status: "started" },
        { transport: "stdout", status: "started" },
        { transport: "otlp-http-protobuf", status: "dropped" },
        { transport: "stdout", status: "dropped" },
        { transport: "stdout", status: "started" },
        { transport: "stdout", status: "dropped" },
        { transport: "otlp-http-protobuf", status: "started" },
        { transport: "stdout", status: "started" },
      ]);
    } finally {
      await service.stop?.(ctx);
    }
  });

  test("exports trusted security events as bounded OTLP logs", async () => {
    await startServiceFixture(["logs"]);
    const trace = createDiagnosticTraceContext(createTestTrace(SPAN_ID));

    emitTrustedSecurityEvent({
      eventId: "security-event-1",
      category: "tool",
      action: "tool.execution.blocked",
      outcome: "denied",
      severity: "medium",
      reason: "tools.deny",
      actor: {
        kind: "agent",
        idHash: "agent-hash-1",
        role: "operator",
        scopes: ["operator.read", "operator.approvals"],
      },
      target: {
        kind: "plugin",
        name: "@acme/security-event-plugin",
        owner: "plugin-installer",
      },
      policy: {
        id: "tools.exec",
        decision: "deny",
        reason: "allowlist.miss",
      },
      control: {
        id: "exec-approval",
        family: "approval",
      },
      attributes: {
        params_kind: "object",
        secretish: "token sk-test-secret",
        [PROTO_KEY]: "blocked",
      },
      trace,
    });
    await flushDiagnosticEvents();

    const emitCall = mockCallArg(logEmit, 0) as {
      attributes?: Record<string, unknown>;
      body?: string;
      context?: unknown;
      severityNumber?: number;
      severityText?: string;
    };
    expect(emitCall.body).toBe("branch.security.event");
    expect(emitCall.severityText).toBe("WARN");
    expect(emitCall.severityNumber).toBe(13);
    expect(emitCall.attributes).toMatchObject({
      "branch.security.event_id": "security-event-1",
      "branch.security.category": "tool",
      "branch.security.action": "tool.execution.blocked",
      "branch.security.outcome": "denied",
      "branch.security.severity": "medium",
      "branch.security.reason": "tools.deny",
      "branch.security.actor.kind": "agent",
      "branch.security.actor.id_hash": "agent-hash-1",
      "branch.security.actor.role": "operator",
      "branch.security.actor.scopes": "operator.read,operator.approvals",
      "branch.security.target.kind": "plugin",
      "branch.security.target.name": "@acme/security-event-plugin",
      "branch.security.target.owner": "plugin-installer",
      "branch.security.policy.id": "tools.exec",
      "branch.security.policy.decision": "deny",
      "branch.security.policy.reason": "allowlist.miss",
      "branch.security.control.id": "exec-approval",
      "branch.security.control.family": "approval",
      "branch.security.attribute.params_kind": "object",
      "branch.security.attribute.secretish": "unknown",
    });
    expect(emitCall.context).toEqual({
      spanContext: {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        traceFlags: 1,
        isRemote: true,
      },
    });
    expect(Object.hasOwn(emitCall.attributes ?? {}, "branch.security.attribute.__proto__")).toBe(
      false,
    );
    expect(JSON.stringify(emitCall)).not.toContain("sk-test-secret");
  });

  test("keeps stdout logs active when the OTLP branch of both is unsupported", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = "grpc";
    const capture = captureStdoutWrites();

    try {
      const { ctx } = await startServiceFixture(["logs"], {
        logsExporter: "both",
        configure: omitConfiguredProtocol,
      });
      emitEvent("log.record", {
        message: "stdout fallback log",
      });
      await flushDiagnosticEvents();

      expect(logExporterCtor).not.toHaveBeenCalled();
      expect(parseSingleStdoutDiagnosticLogLine(capture.writes).body).toBe("log");
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "diagnostics-otel: unsupported logs protocol grpc; OTLP export disabled",
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "diagnostics-otel: logs exporter enabled (stdout JSONL)",
      );
      expect(
        events.map((event) => ({
          signal: event.signal,
          status: event.status,
          reason: event.reason,
        })),
      ).toEqual([
        { signal: "logs", status: "failure", reason: "unsupported_protocol" },
        { signal: "logs", status: "started", reason: "configured" },
      ]);
    } finally {
      capture.spy.mockRestore();
      unsubscribe();
    }
  });

  test.each([
    {
      name: "ignores blank OTLP protocol env overrides",
      value: "   ",
      exporterCalls: 1,
    },
  ])("$name", async ({ value, exporterCalls }) => {
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = value;
    const { ctx } = await startServiceFixture(["traces", "metrics"], omitConfiguredProtocol);

    expect(traceExporterCtor).toHaveBeenCalledTimes(exporterCalls);
    expect(metricExporterCtor).toHaveBeenCalledTimes(exporterCalls);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test("records liveness warning diagnostics", async () => {
    await startServiceFixture(["traces", "metrics"]);
    await emitEventAndFlush("diagnostic.liveness.warning", {
      reasons: ["event_loop_delay", "cpu"],
      intervalMs: 30_000,
      eventLoopDelayP99Ms: 250,
      eventLoopDelayMaxMs: 900,
      eventLoopUtilization: 0.95,
      cpuUserMs: 1200,
      cpuSystemMs: 300,
      cpuTotalMs: 1500,
      cpuCoreRatio: 1.4,
      active: 2,
      waiting: 1,
      queued: 4,
    });

    expect(telemetryState.counters.get("branch.liveness.warning")?.add).toHaveBeenCalledWith(1, {
      "branch.liveness.reason": "event_loop_delay:cpu",
    });
    expect(
      telemetryState.histograms.get("branch.liveness.event_loop_delay_p99_ms")?.record,
    ).toHaveBeenCalledWith(250, {
      "branch.liveness.reason": "event_loop_delay:cpu",
    });
    expect(
      telemetryState.histograms.get("branch.liveness.cpu_core_ratio")?.record,
    ).toHaveBeenCalledWith(1.4, {
      "branch.liveness.reason": "event_loop_delay:cpu",
    });
    const livenessSpanOptions = startedSpanOptions("branch.liveness.warning");
    expect(livenessSpanOptions?.attributes).toMatchObject({
      "branch.liveness.reason": "event_loop_delay:cpu",
      "branch.liveness.active": 2,
      "branch.liveness.queued": 4,
    });
    const span = telemetryState.spans.find((item) => item.name === "branch.liveness.warning");
    expect(span?.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "event_loop_delay:cpu",
    });
  });

  test("records oversized payload metrics without raw identifiers", async () => {
    await startServiceFixture(["metrics"]);
    await emitTrustedEventAndFlush("payload.large", {
      surface: "gateway.frame",
      action: "rejected",
      bytes: 2048,
      limitBytes: 1024,
      channel: "web",
      pluginId: "agent:qa:otel-trace-smoke",
      reason: "body-too-large",
    });

    expect(telemetryState.counters.get("branch.payload.large")?.add).toHaveBeenCalledWith(1, {
      "branch.payload.action": "rejected",
      "branch.payload.surface": "gateway.frame",
      "branch.channel": "web",
      "branch.plugin": "none",
      "branch.reason": "body-too-large",
    });
    expect(
      telemetryState.histograms.get("branch.payload.large_bytes")?.record,
    ).toHaveBeenCalledWith(2048, {
      "branch.payload.action": "rejected",
      "branch.payload.surface": "gateway.frame",
      "branch.channel": "web",
      "branch.plugin": "none",
      "branch.reason": "body-too-large",
    });
  });

  test("reports log exporter emit failures without exporting raw error text", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    logEmit
      .mockImplementationOnce(() => {
        throw new TypeError("token sk-test-secret should not leave as telemetry");
      })
      .mockImplementationOnce(() => {
        throw new TypeError("repeated private failure");
      });

    const { ctx } = await startServiceFixture(["metrics", "logs"]);
    for (const message of ["first failure", "second failure", "recovery"]) {
      await emitEventAndFlush("log.record", {
        message,
      });
    }

    const failureEvent = events.find((event) => event.status === "failure");
    expect(failureEvent?.type).toBe("telemetry.exporter");
    expect(failureEvent?.exporter).toBe("diagnostics-otel");
    expect(failureEvent?.signal).toBe("logs");
    expect(failureEvent?.status).toBe("failure");
    expect(failureEvent?.reason).toBe("emit_failed");
    expect(failureEvent?.errorCategory).toBe("TypeError");
    expect(
      telemetryState.counters.get("branch.telemetry.exporter.events")?.add,
    ).toHaveBeenCalledWith(1, {
      "branch.exporter": "diagnostics-otel",
      "branch.signal": "logs",
      "branch.status": "failure",
      "branch.reason": "emit_failed",
      "branch.errorCategory": "TypeError",
    });
    expect(
      events.filter((event) => event.reason === "emit_failed").map((event) => event.status),
    ).toEqual(["failure"]);
    expect(
      getReportedExporterHealth(ctx)
        .filter(
          (event) => event.transport === "otlp-http-protobuf" && event.reason === "emit_failed",
        )
        .map((event) => event.status),
    ).toEqual(["failure", "recovered"]);
    expect(JSON.stringify({ events, health: getReportedExporterHealth(ctx) })).not.toContain(
      "sk-test-secret",
    );

    unsubscribe();
  });

  test("does not recover log OTLP health while an export failure remains active", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    let completeExport: ((result: ExportResult) => void) | undefined;
    logExporterExport.mockImplementation(
      (_items: unknown, callback: (result: ExportResult) => void) => {
        completeExport = callback;
      },
    );
    logEmit
      .mockImplementationOnce(() => {
        throw new TypeError("private enqueue failure");
      })
      .mockImplementationOnce(() => {});
    const { ctx } = await startServiceFixture(["logs"]);
    const exporter = firstLogProcessorOptions().exporter as
      | {
          export(items: unknown, callback: (result: ExportResult) => void): void;
        }
      | undefined;
    if (!exporter) {
      throw new Error("expected log exporter");
    }

    exporter.export([], vi.fn());
    completeExport?.({
      code: ExportResultCode.FAILED,
      error: new Error("private collector failure"),
    });
    await emitAndFlush({ type: "log.record", level: "INFO", message: "enqueue failure" });
    await emitAndFlush({ type: "log.record", level: "INFO", message: "enqueue recovery" });
    exporter.export([], vi.fn());
    completeExport?.({
      code: ExportResultCode.FAILED,
      error: new Error("repeated private collector failure"),
    });
    await waitForDiagnosticEventsDrained();

    expect(
      getReportedExporterHealth(ctx)
        .filter((event) => event.transport === "otlp-http-protobuf")
        .map(({ status, reason }) => ({ status, reason })),
    ).toEqual([
      { status: "started", reason: "configured" },
      { status: "failure", reason: "export_failed" },
    ]);

    exporter.export([], vi.fn());
    completeExport?.({ code: ExportResultCode.SUCCESS });
    await waitForDiagnosticEventsDrained();
    expect(
      getReportedExporterHealth(ctx)
        .filter((event) => event.transport === "otlp-http-protobuf")
        .map(({ status, reason }) => ({ status, reason })),
    ).toEqual([
      { status: "started", reason: "configured" },
      { status: "failure", reason: "export_failed" },
      { status: "recovered", reason: "export_failed" },
    ]);
    expect(events.map((event) => event.status)).not.toContain("recovered");
    expect(JSON.stringify({ events, health: getReportedExporterHealth(ctx) })).not.toContain(
      "private",
    );

    unsubscribe();
  });

  test("recovers stdout emit health after repeated failures", async () => {
    const { events, unsubscribe } = captureExporterEvents();
    const stdout = captureStdoutWrites();
    const failWrite = (() => {
      throw new TypeError("private stdout failure");
    }) as typeof process.stdout.write;
    stdout.spy.mockImplementationOnce(failWrite).mockImplementationOnce(failWrite);

    try {
      const { ctx } = await startServiceFixture(["logs"], {
        logsExporter: "stdout",
      });
      for (const message of ["first failure", "second failure", "recovery"]) {
        await emitAndFlush({ type: "log.record", level: "INFO", message });
      }

      expect(
        getReportedExporterHealth(ctx)
          .filter((event) => event.transport === "stdout" && event.reason === "emit_failed")
          .map(({ status, errorCategory }) => ({ status, errorCategory })),
      ).toEqual([
        { status: "failure", errorCategory: "TypeError" },
        { status: "recovered", errorCategory: undefined },
      ]);
      expect(events.map((event) => event.status)).not.toContain("recovered");
      expect(stdout.writes).toHaveLength(1);
      expect(JSON.stringify({ events, health: getReportedExporterHealth(ctx) })).not.toContain(
        "private stdout failure",
      );
    } finally {
      stdout.spy.mockRestore();
      unsubscribe();
    }
  });

  test("preserves and recovers bounded exporter facts for log preparation failures", () => {
    const events: ExporterHealthUpdate[] = [];
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const diagnosticsLogs = createDiagnosticsLogExporter({
      contentCapturePolicy: {
        inputMessages: false,
        outputMessages: false,
        toolInputs: false,
        toolOutputs: false,
        systemPrompt: false,
        toolDefinitions: false,
        logBodies: false,
      },
      emitExporterEvent: createExporterHealthEventEmitter((event) => {
        events.push(event);
      }),
      logger,
      logsEnabled: true,
      logsToOtlp: true,
      logsToStdout: false,
      resource: {} as never,
      serviceName: "branch-test",
    });
    const attributes = new Proxy<Record<string, string | number | boolean>>(
      {},
      {
        ownKeys() {
          throw new TypeError("private preparation details");
        },
      },
    );

    const recordLog = (
      seq: number,
      recordAttributes: Record<string, string | number | boolean>,
    ) => {
      diagnosticsLogs.recordLogRecord?.(
        {
          type: "log.record",
          seq,
          ts: seq,
          level: "INFO",
          message: "prepare me",
          attributes: recordAttributes,
        },
        { trusted: false },
      );
    };
    recordLog(1, attributes);
    recordLog(2, attributes);
    recordLog(3, {});

    expect(
      events.map(({ transport, status, reason, errorCategory }) => ({
        transport,
        status,
        reason,
        errorCategory,
      })),
    ).toEqual([
      {
        transport: "otlp-http-protobuf",
        status: "failure",
        reason: "emit_failed",
        errorCategory: "TypeError",
      },
      {
        transport: "otlp-http-protobuf",
        status: "recovered",
        reason: "emit_failed",
        errorCategory: undefined,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("private preparation details");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("diagnostics-otel: log record export failed"),
    );
  });

  test("ignores untrusted telemetry exporter events for OTEL metrics", async () => {
    await startServiceFixture(["metrics"]);
    telemetryState.counters.get("branch.telemetry.exporter.events")?.add.mockClear();
    emitEvent("telemetry.exporter", {
      exporter: "spoofed-plugin-exporter",
      signal: "metrics",
      status: "failure",
      reason: "emit_failed",
    });

    expect(
      telemetryState.counters.get("branch.telemetry.exporter.events")?.add,
    ).not.toHaveBeenCalled();
  });

  test("records hook-blocked run metrics with safe blocker originator", async () => {
    await startServiceFixture(["traces", "metrics"]);

    await emitAndFlush({
      type: "run.completed",
      ...RUN_FIXTURE,
      outcome: "blocked",
      blockedBy: "policy-plugin",
      durationMs: 100,
    });

    const runDurationRecordCall = lastHistogramRecord("branch.run.duration_ms");
    expect(runDurationRecordCall?.[0]).toBe(100);
    expect(runDurationRecordCall?.[1]?.["branch.outcome"]).toBe("blocked");
    expect(runDurationRecordCall?.[1]?.["branch.blocked_by"]).toBe("policy-plugin");
    expect(JSON.stringify(telemetryState)).not.toContain("matched secret prompt");
  });

  test("run.completed bounds sensitive error text before export", async () => {
    await startServiceFixture(["traces"]);
    const secret = "sk-1234567890abcdef";

    emitTrustedDiagnosticEventWithPrivateData(
      {
        type: "run.completed",
        runId: "run-1",
        outcome: "error",
        errorCategory: "Error",
        durationMs: 100,
      },
      { errorMessage: `OPENAI_API_KEY=${secret} ${"x".repeat(8 * 1024)}` },
    );
    await flushDiagnosticEvents();

    const status = mockCallArg(spanByName("branch.run").setStatus, 0) as {
      message?: string;
    };
    expect(status.message).not.toContain(secret);
    expect(status.message).toMatch(/\.\.\.\(truncated\)$/u);
    expect(status.message?.length).toBeLessThanOrEqual(4 * 1024 + 20);
  });

  test("harness.run.completed error span carries the redacted message", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedDiagnosticEventWithPrivateData(
      eventFixture(
        "harness.run.completed",
        {
          runId: "run-1",
          provider: "openai",
          model: "gpt-5.4",
          outcome: "error",
        },
        ["trace"],
      ),
      { errorMessage: "model run failed during resolve phase" },
    );
    await flushDiagnosticEvents();

    expect(startedSpanOptions("branch.harness.run")?.attributes?.["branch.error"]).toBe(
      "model run failed during resolve phase",
    );
    expect(spanByName("branch.harness.run").setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "model run failed during resolve phase",
    });
    const harnessDuration = lastHistogramRecord("branch.harness.duration_ms");
    expect(Object.hasOwn(harnessDuration?.[1] ?? {}, "branch.error")).toBe(false);
  });

  test("lets explicit Branch Agent sampling override the inherited sampler environment", async () => {
    process.env.OTEL_TRACES_SAMPLER = "always_off";
    await startServiceFixture(["traces"], (ctx) => {
      ctx.config.diagnostics!.otel!.sampleRate = 1;
    });

    const traceOptions = mockCallArg(traceProviderCtor, 0) as Record<string, unknown>;
    expect(traceOptions.sampler).toBeDefined();
    expect(traceOptions).not.toHaveProperty("spanLimits");
  });

  test.each(["0"])(
    "falls back from invalid positive-only OTel interval values: %s",
    async (value) => {
      process.env.OTEL_BSP_MAX_QUEUE_SIZE = value;
      process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE = value;
      process.env.OTEL_BSP_SCHEDULE_DELAY = value;
      process.env.OTEL_BSP_EXPORT_TIMEOUT = value;
      process.env.OTEL_METRIC_EXPORT_INTERVAL = value;
      process.env.OTEL_METRIC_EXPORT_TIMEOUT = value;

      await startServiceFixture(["traces", "metrics"]);

      expect(firstSpanProcessorOptions()).toMatchObject({
        exportTimeoutMillis: 30_000,
        maxExportBatchSize: 512,
        maxQueueSize: 2048,
        scheduledDelayMillis: 5000,
      });
      expect(firstMetricReaderOptions()).toMatchObject({
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: 30_000,
      });
    },
  );

  test("clamps metric timeout to interval and wires experimental SDK metrics", async () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = "2000";
    process.env.OTEL_METRIC_EXPORT_TIMEOUT = "3000";
    process.env.OTEL_NODE_EXPERIMENTAL_SDK_METRICS = "true";

    await startServiceFixture(["traces", "metrics"]);

    expect(firstMetricReaderOptions()).toMatchObject({
      exportIntervalMillis: 2000,
      exportTimeoutMillis: 2000,
    });
    const meterOptions = mockCallArg(meterProviderCtor, 0) as Record<string, unknown>;
    expect(meterOptions.sdkMetricsEnabled).toBe(true);
    expect(
      (mockCallArg(traceProviderCtor, 0) as Record<string, unknown>).meterProvider,
    ).toBeDefined();
    expect(firstSpanProcessorOptions().selfObsMeterProvider).toBeDefined();
    expect(diagWarn).toHaveBeenCalledWith(
      "OTEL_METRIC_EXPORT_TIMEOUT (3000) is greater than the active metric export interval (2000). Clamping timeout to interval value.",
    );
  });

  test("ignores malformed shared OTLP env when valid signal endpoints shadow it", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://operator:qa-ignored-shared-password@[";
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://trace-env.example.com/v1/traces";
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://metric-env.example.com/v1/metrics";
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://log-env.example.com/v1/logs";

    await startServiceFixture(["traces", "metrics", "logs"]);

    expect(firstExporterOptions(traceExporterCtor).url).toBe(
      "https://trace-env.example.com/v1/traces",
    );
    expect(firstExporterOptions(metricExporterCtor).url).toBe(
      "https://metric-env.example.com/v1/metrics",
    );
    expect(firstExporterOptions(logExporterCtor).url).toBe("https://log-env.example.com/v1/logs");
  });

  test.each([
    { label: "none", env: "none", expected: [] },
    {
      label: "all",
      env: "all",
      expected: ["host", "os", "serviceinstance", "process", "env"],
    },
    {
      label: "subset with invalid name",
      env: "process,invalid-name",
      expected: ["process"],
    },
  ] as const)(
    "passes the $label resource detectors to detectResources",
    async ({ env, expected }) => {
      process.env.OTEL_NODE_RESOURCE_DETECTORS = env;
      await startServiceFixture(["traces"]);
      const call = detectResourcesMock.mock.calls.at(-1)?.[0] as
        | { detectors?: Array<{ detector: string }> }
        | undefined;
      expect(call?.detectors?.map((detector) => detector.detector)).toEqual(expected);
      if (env?.includes("invalid-name")) {
        expect(diagWarn).toHaveBeenCalledWith(
          'Invalid resource detector "invalid-name" specified in the environment variable OTEL_NODE_RESOURCE_DETECTORS',
        );
      }
    },
  );

  test("preserves OTLP TLS env options when passing env proxy agents", async () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "branch-otel-tls-"));
    try {
      const rootCertificatePath = path.join(certDir, "root.pem");
      const clientCertificatePath = path.join(certDir, "client.pem");
      const sharedClientCertificatePath = path.join(certDir, "shared-client.pem");
      const clientKeyPath = path.join(certDir, "client-key.pem");
      writeFileSync(rootCertificatePath, "root-certificate");
      writeFileSync(clientCertificatePath, "trace-client-certificate");
      writeFileSync(sharedClientCertificatePath, "shared-client-certificate");
      writeFileSync(clientKeyPath, "client-key");
      process.env.OTEL_EXPORTER_OTLP_CERTIFICATE = rootCertificatePath;
      process.env.OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE = sharedClientCertificatePath;
      process.env.OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE = clientCertificatePath;
      process.env.OTEL_EXPORTER_OTLP_CLIENT_KEY = clientKeyPath;
      createNodeProxyAgentMock.mockReturnValue(nodeProxyAgent);

      await startOtelService({
        endpoint: "https://collector.example.com/otlp",
        traces: true,
        metrics: true,
        logs: true,
      });

      const traceCall = findCreateNodeProxyAgentCall(
        "https://collector.example.com/otlp/v1/traces",
      );
      const metricCall = findCreateNodeProxyAgentCall(
        "https://collector.example.com/otlp/v1/metrics",
      );
      expect(traceCall.agentOptions).toEqual({
        keepAlive: true,
        ca: Buffer.from("root-certificate"),
        cert: Buffer.from("trace-client-certificate"),
        key: Buffer.from("client-key"),
      });
      expect(metricCall.agentOptions).toEqual({
        keepAlive: true,
        ca: Buffer.from("root-certificate"),
        cert: Buffer.from("shared-client-certificate"),
        key: Buffer.from("client-key"),
      });
    } finally {
      rmSync(certDir, { force: true, recursive: true });
    }
  });

  test("pins validated collector TLS material on direct HTTPS exporter agents", async () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "branch-otel-direct-tls-"));
    try {
      const rootCertificatePath = path.join(certDir, "root.pem");
      writeFileSync(rootCertificatePath, "explicit-root-certificate");
      process.env.OTEL_EXPORTER_OTLP_CERTIFICATE = rootCertificatePath;

      await startOtelService({
        endpoint: "https://collector.example.com/otlp",
        traces: true,
      });

      expect(firstExporterOptions(traceExporterCtor).httpAgentOptions).toEqual({
        keepAlive: true,
        ca: Buffer.from("explicit-root-certificate"),
      });
    } finally {
      rmSync(certDir, { force: true, recursive: true });
    }
  });

  test("validates log TLS before constructing any trace, metric, or SDK owner", async () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE =
      "/definitely-missing/qa-otel-log-root-atomic.pem";

    await expect(
      startOtelService({
        endpoint: "https://collector.example.com/otlp",
        traces: true,
        metrics: true,
        logs: true,
      }),
    ).rejects.toThrow(
      "Configured OpenTelemetry TLS root certificate file is missing, empty, or unreadable; refusing insecure export",
    );

    expect(traceExporterCtor).not.toHaveBeenCalled();
    expect(metricExporterCtor).not.toHaveBeenCalled();
    expect(logExporterCtor).not.toHaveBeenCalled();
    expect(traceProviderCtor).not.toHaveBeenCalled();
    expect(meterProviderCtor).not.toHaveBeenCalled();
  });

  test("never falls back from an unreadable signal TLS file to readable shared trust", async () => {
    process.env.OTEL_EXPORTER_OTLP_CERTIFICATE = process.execPath;
    process.env.OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE =
      "/definitely-missing/qa-otel-signal-override.pem";

    await expect(startOtelService({ traces: true })).rejects.toThrow(
      "Configured OpenTelemetry TLS root certificate file is missing, empty, or unreadable; refusing insecure export",
    );
    expect(traceExporterCtor).not.toHaveBeenCalled();
  });

  test("keeps valid ambient TLS material compatible with plain HTTP collectors", async () => {
    process.env.OTEL_EXPORTER_OTLP_CERTIFICATE = process.execPath;

    await startOtelService({ endpoint: "http://collector.example.com/otlp", traces: true });

    expect(traceExporterCtor).toHaveBeenCalledTimes(1);
    expect(firstExporterOptions(traceExporterCtor).httpAgentOptions).toBeUndefined();
  });

  test("still validates plugin-owned OTLP logs when a trace SDK is preloaded", async () => {
    process.env.BRANCH_OTEL_PRELOADED = "1";
    process.env.OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE =
      "/definitely-missing/qa-otel-preloaded-log-root.pem";

    await expect(startOtelService({ traces: true, logs: true })).rejects.toThrow(
      "Configured OpenTelemetry TLS root certificate file is missing, empty, or unreadable; refusing insecure export",
    );
    expect(logExporterCtor).not.toHaveBeenCalled();
  });

  test("redacts proxy credentials from telemetry startup failures", async () => {
    const proxyPassword = "qa-otel-proxy-password-sentinel";
    createNodeProxyAgentMock.mockImplementation(() => {
      throw new Error(`Invalid proxy URL: "https://operator:${proxyPassword}@proxy.example.com"`);
    });

    const failure = await startOtelService({
      endpoint: "https://collector.example.com/otlp",
      traces: true,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: "Configured telemetry proxy is invalid or unsupported; refusing direct export",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(String(failure)).not.toContain(proxyPassword);
    expect(traceExporterCtor).not.toHaveBeenCalled();
  });

  test("exports diagnostic logs as stdout JSONL without constructing the OTLP log exporter", async () => {
    await startServiceFixture(["logs"], {
      endpoint: "",
      logsExporter: "stdout",
      captureContent: true,
      configure: (ctx) => {
        ctx.config.diagnostics!.otel!.serviceName = "rovogrove-branch";
      },
    });
    const stdout = captureStdoutWrites();

    try {
      expect(logExporterCtor).not.toHaveBeenCalled();
      emitDiagnosticEventWithTrustedTraceContext({
        type: "log.record",
        level: "WARN",
        message: "Using API key sk-1234567890abcdef1234567890abcdef",
        attributes: {
          token: "ghp_abcdefghijklmnopqrstuvwxyz123456", // pragma: allowlist secret
          subsystem: "diagnostic",
        },
        trace: createTestTrace(SPAN_ID),
      });
      await flushDiagnosticEvents();

      expect(logEmit).not.toHaveBeenCalled();
      const record = parseSingleStdoutDiagnosticLogLine(stdout.writes);
      expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(record.signal).toBe("branch.diagnostic.log");
      expect(record["service.name"]).toBe("rovogrove-branch");
      expect(record.severityText).toBe("WARN");
      expect(record.severityNumber).toBe(13);
      expect(String(record.body)).not.toContain("sk-1234567890abcdef1234567890abcdef");
      expect(String(record.body)).toContain("sk-123");
      expect(record.attributes).toMatchObject({
        "branch.log.level": "WARN",
        "branch.subsystem": "diagnostic",
      });
      const tokenAttr = record.attributes?.["branch.token"];
      expect(tokenAttr).not.toBe("ghp_abcdefghijklmnopqrstuvwxyz123456"); // pragma: allowlist secret
      expect(record.trace_id).toBe(TRACE_ID);
      expect(record.span_id).toBe(SPAN_ID);
      expect(JSON.stringify(record)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456"); // pragma: allowlist secret
    } finally {
      stdout.spy.mockRestore();
    }
  });

  test("does not attach untrusted diagnostic trace context to exported logs", async () => {
    const emitCall = await emitAndCaptureLog({
      level: "INFO",
      message: "traceable log",
      attributes: {
        subsystem: "diagnostic",
      },
      trace: createTestTrace(SPAN_ID),
    });

    expect(Object.hasOwn(emitCall?.attributes ?? {}, "branch.traceId")).toBe(false);
    expect(Object.hasOwn(emitCall?.attributes ?? {}, "branch.spanId")).toBe(false);
    expect(Object.hasOwn(emitCall?.attributes ?? {}, "branch.traceFlags")).toBe(false);
    expect(telemetryState.tracer.setSpanContext).not.toHaveBeenCalled();
    expect(emitCall?.context).toBeUndefined();
  });

  test("bounds plugin-emitted log attributes and omits source paths", async () => {
    await startOtelService({ logs: true, captureContent: true });

    const boundaryMessage = `${"x".repeat(4095)}🚀tail`;
    const boundaryAttribute = `${"y".repeat(4095)}🚀tail`;
    const attributes = Object.create(null) as Record<string, string>;
    attributes.good = boundaryAttribute;
    attributes["bad key"] = "drop-me";
    attributes[PROTO_KEY] = "pollute";
    attributes["constructor"] = "pollute";
    attributes["prototype"] = "pollute";
    attributes["sk-1234567890abcdef1234567890abcdef"] = "secret-key"; // pragma: allowlist secret

    emitDiagnosticEvent({
      type: "log.record",
      level: "INFO",
      message: boundaryMessage,
      attributes,
      code: {
        filepath: "/Users/alice/branch/src/private.ts",
        line: 42,
        functionName: "handler",
        location: "/Users/alice/branch/src/private.ts:42",
      },
    } as Parameters<typeof emitDiagnosticEvent>[0]);
    await flushDiagnosticEvents();

    const emitCall = mockCallArg(logEmit, 0) as {
      attributes: Record<string, unknown>;
      body: string;
    };
    expect(emitCall.body).toBe(`${"x".repeat(4095)}...(truncated)`);
    expect(emitCall.attributes["branch.good"]).toBe(`${"y".repeat(4095)}...(truncated)`);
    expect(emitCall.attributes).toMatchObject({
      "code.lineno": 42,
      "code.function": "handler",
    });
    expect(Object.hasOwn(emitCall.attributes, `branch.${PROTO_KEY}`)).toBe(false);
    expect(Object.hasOwn(emitCall.attributes, "branch.constructor")).toBe(false);
    expect(Object.hasOwn(emitCall.attributes, "branch.prototype")).toBe(false);
    expect(
      Object.hasOwn(
        emitCall.attributes,
        "branch.sk-1234567890abcdef1234567890abcdef", // pragma: allowlist secret
      ),
    ).toBe(false);
    expect(Object.hasOwn(emitCall.attributes, "branch.bad key")).toBe(false);
    expect(Object.hasOwn(emitCall.attributes, "code.filepath")).toBe(false);
    expect(Object.hasOwn(emitCall.attributes, "branch.code.location")).toBe(false);
  });

  test.each([
    [
      "drops session-shaped queue lane metric attributes",
      "session:Agent:qa:otel-trace-smoke",
      "session",
      "Agent:qa:otel-trace-smoke",
    ],
  ])("%s", async (_name, lane, expected, omitted) => {
    await startServiceFixture(["metrics"]);

    await emitEventAndFlush("queue.lane.enqueue", {
      lane,
      queueSize: 2,
    });

    expect(telemetryState.counters.get("branch.queue.lane.enqueue")?.add).toHaveBeenCalledWith(
      1,
      {
        "branch.lane": expected,
      },
    );
    expect(
      JSON.stringify(telemetryState.counters.get("branch.queue.lane.enqueue")?.add.mock.calls),
    ).not.toContain(omitted);
  });

  test("exports GenAI usage attributes on model usage spans without diagnostic identifiers", async () => {
    await startServiceFixture(["traces"]);

    await emitAndFlush({
      type: "model.usage",
      sessionKey: "session-key",
      sessionId: "session-id",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4.6",
      usage: {
        input: 100,
        output: 40,
        cacheRead: 30,
        cacheWrite: 20,
        promptTokens: 150,
        total: 190,
      },
      durationMs: 25,
    });

    const modelUsageOptions = startedSpanOptions("branch.model.usage");
    expect(modelUsageOptions?.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "anthropic/claude-sonnet-4.6",
      "gen_ai.usage.input_tokens": 150,
      "gen_ai.usage.output_tokens": 40,
      "gen_ai.usage.cache_read.input_tokens": 30,
      "gen_ai.usage.cache_creation.input_tokens": 20,
    });
    expect(Object.hasOwn(modelUsageOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(Object.hasOwn(modelUsageOptions?.attributes ?? {}, "branch.sessionId")).toBe(false);
    expect(Object.hasOwn(modelUsageOptions?.attributes ?? {}, "gen_ai.provider.name")).toBe(false);
    expect(Object.hasOwn(modelUsageOptions?.attributes ?? {}, "gen_ai.input.messages")).toBe(false);
    expect(Object.hasOwn(modelUsageOptions?.attributes ?? {}, "gen_ai.output.messages")).toBe(
      false,
    );
    expect(modelUsageOptions?.startTime).toBeTypeOf("number");
    expect(JSON.stringify(modelUsageOptions)).not.toContain("session-key");
  });

  test("exports skill usage counter and span without raw identifiers", async () => {
    await startServiceFixture(["traces", "metrics"]);

    await emitTrustedEventAndFlush("skill.used", {
      agentId: "main",
      runId: "run-should-not-export",
      sessionKey: "session-should-not-export",
      skillName: "tiny-llm-brainstorm",
      skillSource: "workspace",
      activation: "read",
      toolName: "read",
      trace: createTestTrace(TOOL_SPAN_ID, CHILD_SPAN_ID),
    });

    const expectedAttrs = {
      "branch.agent": "main",
      "branch.skill.activation": "read",
      "branch.skill.name": "tiny-llm-brainstorm",
      "branch.skill.source": "workspace",
      "branch.toolName": "read",
    };
    expect(telemetryState.counters.get("branch.skill.used")?.add).toHaveBeenCalledWith(
      1,
      expectedAttrs,
    );
    const skillSpanCall = telemetryState.tracer.startSpan.mock.calls.find(
      (call) => call[0] === "branch.skill.used",
    );
    expect(skillSpanCall?.[1]).toMatchObject({ attributes: expectedAttrs });
    expect(JSON.stringify(skillSpanCall)).not.toContain("run-should-not-export");
    expect(JSON.stringify(skillSpanCall)).not.toContain("session-should-not-export");
  });

  test("exports run, model call, and tool execution lifecycle spans", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitEvent("run.completed", {
      runId: "run-1",
      sessionKey: "session-key",
      ...MODEL_FIXTURE,
      channel: "webchat",
      trace: createTestTrace(SPAN_ID),
    });
    emitEvent("model.call.completed", {
      api: "completions",
      transport: "http",
      requestPayloadBytes: 1234,
      responseStreamBytes: 567,
      timeToFirstByteMs: 45,
      promptStats: {
        inputMessagesCount: 2,
        inputMessagesChars: 3456,
        systemPromptChars: 789,
        toolDefinitionsCount: 4,
        toolDefinitionsChars: 2345,
        totalChars: 6590,
      },
      usage: {
        input: 100,
        output: 20,
        cacheRead: 30,
        cacheWrite: 5,
        reasoningTokens: 8,
        promptTokens: 135,
        total: 155,
      },
      trace: createTestTrace(CHILD_SPAN_ID, SPAN_ID),
    });
    emitEvent("harness.run.completed", {
      runId: "run-1",
      sessionKey: "session-key",
      sessionId: "session-1",
      provider: "codex",
      model: "gpt-5.4",
      channel: "qa",
      harnessId: "codex",
      pluginId: "codex-plugin",
      resultClassification: "reasoning-only",
      yieldDetected: true,
      itemLifecycle: { startedCount: 3, completedCount: 2, activeCount: 1 },
    });
    await emitEventAndFlush("tool.execution.error", {
      toolCallId: "tool-1",
      paramsSummary: { kind: "object" },
      errorCode: "429",
      trace: createTestTrace(GRANDCHILD_SPAN_ID, CHILD_SPAN_ID),
    });

    const spanNames = telemetryState.tracer.startSpan.mock.calls.map((call) => call[0]);
    expect(spanNames).toContain("branch.run");
    expect(spanNames).toContain("branch.model.call");
    expect(spanNames).toContain("branch.harness.run");
    expect(spanNames).toContain("branch.tool.execution");

    const runOptions = startedSpanOptions("branch.run");
    expect(runOptions?.attributes).toMatchObject({
      "branch.outcome": "completed",
      "branch.provider": "openai",
      "branch.model": "gpt-5.4",
      "branch.channel": "webchat",
    });
    expect(Object.hasOwn(runOptions?.attributes ?? {}, "gen_ai.system")).toBe(false);
    expect(Object.hasOwn(runOptions?.attributes ?? {}, "gen_ai.request.model")).toBe(false);
    expect(Object.hasOwn(runOptions?.attributes ?? {}, "branch.runId")).toBe(false);
    expect(Object.hasOwn(runOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(Object.hasOwn(runOptions?.attributes ?? {}, "branch.traceId")).toBe(false);
    expect(runOptions?.startTime).toBeTypeOf("number");

    const modelCall = startedSpanCall("branch.model.call");
    const modelOptions = modelCall?.[1];
    expect(modelOptions?.attributes).toMatchObject({
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-5.4",
      "gen_ai.operation.name": "text_completion",
    });
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "gen_ai.provider.name")).toBe(false);
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "branch.callId")).toBe(false);
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "branch.runId")).toBe(false);
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(modelOptions?.startTime).toBeTypeOf("number");
    expect(modelOptions?.kind).toBe(2);
    expect(modelCall?.[2]).toBeUndefined();

    const harnessCall = startedSpanCall("branch.harness.run");
    const harnessOptions = harnessCall?.[1];
    expect(harnessOptions?.attributes).toMatchObject({
      "branch.harness.id": "codex",
      "branch.harness.plugin": "codex-plugin",
      "branch.outcome": "completed",
      "branch.provider": "codex",
      "branch.model": "gpt-5.4",
      "branch.channel": "qa",
      "branch.harness.result_classification": "reasoning-only",
      "branch.harness.yield_detected": true,
      "branch.harness.items.started": 3,
      "branch.harness.items.completed": 2,
      "branch.harness.items.active": 1,
    });
    expect(Object.hasOwn(harnessOptions?.attributes ?? {}, "branch.runId")).toBe(false);
    expect(Object.hasOwn(harnessOptions?.attributes ?? {}, "branch.sessionId")).toBe(false);
    expect(Object.hasOwn(harnessOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(Object.hasOwn(harnessOptions?.attributes ?? {}, "branch.traceId")).toBe(false);
    expect(harnessOptions?.startTime).toBeTypeOf("number");
    expect(harnessCall?.[2]).toBeUndefined();

    const toolCall = startedSpanCall("branch.tool.execution");
    const toolOptions = toolCall?.[1];
    expect(toolOptions?.attributes).toMatchObject({
      "branch.toolName": "read",
      "branch.tool.source": "core",
      "branch.errorCategory": "TypeError",
      "branch.errorCode": "429",
      "branch.tool.params.kind": "object",
      "gen_ai.tool.name": "read",
    });
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "branch.toolCallId")).toBe(false);
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "branch.runId")).toBe(false);
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(toolOptions?.startTime).toBeTypeOf("number");
    expect(Object.hasOwn(toolOptions ?? {}, "kind")).toBe(false);
    expect(toolCall?.[2]).toBeUndefined();

    const modelCallDuration = lastHistogramRecord("branch.model_call.duration_ms");
    expect(modelCallDuration?.[0]).toBe(80);
    expect(modelCallDuration?.[1]?.["branch.provider"]).toBe("openai");
    expect(modelCallDuration?.[1]?.["branch.model"]).toBe("gpt-5.4");
    const requestBytes = lastHistogramRecord("branch.model_call.request_bytes");
    expect(requestBytes?.[0]).toBe(1234);
    expect(requestBytes?.[1]?.["branch.provider"]).toBe("openai");
    expect(requestBytes?.[1]?.["branch.model"]).toBe("gpt-5.4");
    const responseBytes = lastHistogramRecord("branch.model_call.response_bytes");
    expect(responseBytes?.[0]).toBe(567);
    expect(responseBytes?.[1]?.["branch.provider"]).toBe("openai");
    expect(responseBytes?.[1]?.["branch.model"]).toBe("gpt-5.4");
    const timeToFirstByte = lastHistogramRecord("branch.model_call.time_to_first_byte_ms");
    expect(timeToFirstByte?.[0]).toBe(45);
    expect(timeToFirstByte?.[1]?.["branch.provider"]).toBe("openai");
    expect(timeToFirstByte?.[1]?.["branch.model"]).toBe("gpt-5.4");
    const modelSpanAttributes = firstSpanAttributes("branch.model.call");
    expect(modelSpanAttributes).toMatchObject({
      "branch.model_call.request_bytes": 1234,
      "branch.model_call.response_bytes": 567,
      "branch.model_call.time_to_first_byte_ms": 45,
      "branch.model_call.prompt.input_messages_count": 2,
      "branch.model_call.prompt.input_messages_chars": 3456,
      "branch.model_call.prompt.system_prompt_chars": 789,
      "branch.model_call.prompt.tool_definitions_count": 4,
      "branch.model_call.prompt.tool_definitions_chars": 2345,
      "branch.model_call.prompt.total_chars": 6590,
      "branch.model_call.usage.input_tokens": 100,
      "branch.model_call.usage.output_tokens": 20,
      "branch.model_call.usage.cache_read_input_tokens": 30,
      "branch.model_call.usage.cache_creation_input_tokens": 5,
      "branch.model_call.usage.reasoning_output_tokens": 8,
      "branch.model_call.usage.prompt_tokens": 135,
      "branch.model_call.usage.total_tokens": 155,
      "gen_ai.usage.input_tokens": 135,
      "gen_ai.usage.output_tokens": 20,
    });
    const runDuration = lastHistogramRecord("branch.run.duration_ms");
    expect(runDuration?.[0]).toBe(100);
    expect(Object.hasOwn(runDuration?.[1] ?? {}, "branch.runId")).toBe(false);
    const harnessDuration = lastHistogramRecord("branch.harness.duration_ms");
    expect(harnessDuration?.[0]).toBe(90);
    expect(harnessDuration?.[1]?.["branch.harness.id"]).toBe("codex");
    expect(harnessDuration?.[1]?.["branch.harness.plugin"]).toBe("codex-plugin");
    expect(harnessDuration?.[1]?.["branch.outcome"]).toBe("completed");
    expect(Object.hasOwn(harnessDuration?.[1] ?? {}, "branch.runId")).toBe(false);
    expect(Object.hasOwn(harnessDuration?.[1] ?? {}, "branch.sessionKey")).toBe(false);
    const toolDuration = lastHistogramRecord("branch.tool.execution.duration_ms");
    expect(toolDuration?.[0]).toBe(20);
    expect(toolDuration?.[1]?.["branch.tool.source"]).toBe("core");
    expect(Object.hasOwn(toolDuration?.[1] ?? {}, "branch.errorCode")).toBe(false);
    expect(Object.hasOwn(toolDuration?.[1] ?? {}, "branch.runId")).toBe(false);

    const toolSpan = spanByName("branch.tool.execution");
    expect(toolSpan?.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "TypeError",
    });
    expect(firstSpanEndTime("branch.tool.execution")).toBeTypeOf("number");
    expect(telemetryState.tracer.setSpanContext).not.toHaveBeenCalled();
  });

  test("closes a tracked blocked tool span once without creating a duplicate", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedEvent("tool.execution.started", {
      runId: "run-blocked",
      toolName: "exec",
      toolCallId: "call-blocked",
      sourceTimestampMs: 1_000,
      trace: createTestTrace(TOOL_SPAN_ID, CHILD_SPAN_ID),
    });
    await emitTrustedEventAndFlush("tool.execution.blocked", {
      runId: "run-blocked",
      toolName: "exec",
      toolCallId: "call-blocked",
      deniedReason: "tools.deny",
      reason: "policy denied",
      sourceTimestampMs: 1_250,
      trace: createTestTrace(TOOL_SPAN_ID, CHILD_SPAN_ID),
    });

    const toolSpans = telemetryState.spans.filter(
      (span) => span.name === "branch.tool.execution",
    );
    expect(toolSpans).toHaveLength(1);
    expect(startedSpanOptions("branch.tool.execution")?.startTime).toBe(1_000);
    expect(toolSpans[0]?.end).toHaveBeenCalledTimes(1);
    expect(toolSpans[0]?.end).toHaveBeenCalledWith(1_250);
  });

  test("uses authoritative source timestamps for terminal-only tool spans", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedDiagnosticEvent({
      type: "tool.execution.completed",
      runId: "run-completed",
      toolName: "read",
      toolCallId: "call-completed",
      durationMs: 250,
      sourceTimestampMs: 5_000,
    });
    await emitTrustedAndFlush({
      type: "tool.execution.error",
      runId: "run-error",
      toolName: "write",
      toolCallId: "call-error",
      durationMs: 500,
      errorCategory: "test",
      sourceTimestampMs: 7_000,
    });

    const toolSpanCalls = telemetryState.tracer.startSpan.mock.calls.filter(
      (call) => call[0] === "branch.tool.execution",
    );
    const toolSpans = telemetryState.spans.filter(
      (span) => span.name === "branch.tool.execution",
    );
    expect(toolSpanCalls).toHaveLength(2);
    expect((toolSpanCalls[0]?.[1] as { startTime?: number } | undefined)?.startTime).toBe(4_750);
    expect((toolSpanCalls[1]?.[1] as { startTime?: number } | undefined)?.startTime).toBe(6_500);
    expect(toolSpans[0]?.end).toHaveBeenCalledWith(5_000);
    expect(toolSpans[1]?.end).toHaveBeenCalledWith(7_000);
  });

  test("exports model failover spans", async () => {
    await startServiceFixture(["traces", "metrics"]);

    await emitTrustedEventAndFlush("model.failover", {
      sessionId: "session-1",
      lane: "main",
      fromProvider: "anthropic",
      fromModel: "claude-opus-4-6",
      toProvider: "openai",
      toModel: "gpt-5.4",
      reason: "overloaded",
      suspended: true,
      cascadeDepth: 1,
    });

    const failoverOptions = startedSpanOptions("branch.model.failover");
    expect(failoverOptions?.attributes).toMatchObject({
      "branch.provider": "anthropic",
      "branch.model": "claude-opus-4-6",
      "branch.failover.to_provider": "openai",
      "branch.failover.to_model": "gpt-5.4",
      "branch.failover.reason": "overloaded",
      "branch.failover.suspended": true,
      "branch.failover.cascade_depth": 1,
      "branch.lane": "main",
    });
    expect(Object.hasOwn(failoverOptions?.attributes ?? {}, "branch.sessionId")).toBe(false);
    expect(Object.hasOwn(failoverOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(failoverOptions?.startTime).toBeTypeOf("number");
    expect(firstSpanEndTime("branch.model.failover")).toBeTypeOf("number");
    expect(firstCounterAddCall("branch.model.failover")).toStrictEqual([
      1,
      {
        "branch.failover.reason": "overloaded",
        "branch.failover.suspended": "true",
        "branch.lane": "main",
        "branch.model": "claude-opus-4-6",
        "branch.provider": "anthropic",
        "branch.failover.to_model": "gpt-5.4",
        "branch.failover.to_provider": "openai",
      },
    ]);
  });

  test("records blocked tool metrics even when traces are disabled", async () => {
    await startServiceFixture(["metrics"]);

    await emitTrustedEventAndFlush("tool.execution.blocked", {
      runId: "run-should-not-export",
      toolName: "browser",
      toolSource: "mcp",
      toolOwner: "browser-tools",
      deniedReason: "tools.deny",
      reason: "matched browser",
      paramsSummary: { kind: "object" },
    });

    expect(firstCounterAddCall("branch.tool.execution.blocked")).toStrictEqual([
      1,
      {
        "branch.toolName": "browser",
        "branch.tool.source": "mcp",
        "gen_ai.tool.name": "browser",
        "branch.tool.owner": "browser-tools",
        "branch.tool.params.kind": "object",
        "branch.deniedReason": "tools.deny",
      },
    ]);
    expect(telemetryState.tracer.startSpan).not.toHaveBeenCalledWith(
      "branch.tool.execution",
      expect.anything(),
      expect.anything(),
    );
  });

  test("maps model call APIs and preserves zero usage on terminal spans", async () => {
    await startServiceFixture(["traces", "metrics"]);
    const zeroUsage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoningTokens: 0,
      total: 0,
    };

    emitDiagnosticEvent({
      type: "model.call.completed",
      ...MODEL_CALL_FIXTURE,
      api: "openai-completions",
      durationMs: 80,
      requestPayloadBytes: 0,
      responseStreamBytes: 0,
      timeToFirstByteMs: 0,
      usage: zeroUsage,
    });
    emitDiagnosticEvent({
      type: "model.call.completed",
      runId: "run-1",
      callId: "call-2",
      provider: "google",
      model: "gemini-2.5-flash",
      api: "google-generative-ai",
      durationMs: 90,
    });
    emitDiagnosticEvent({
      type: "model.call.error",
      runId: "run-1",
      callId: "call-3",
      ...MODEL_FIXTURE,
      api: "openai-responses",
      durationMs: 40,
      errorCategory: "TimeoutError",
      usage: zeroUsage,
    });
    await emitAndFlush({
      type: "model.call.completed",
      ...MODEL_CALL_FIXTURE,
      callId: "call-cache-only",
      durationMs: 30,
      usage: { cacheWrite: 7 },
    });

    const modelCallAttrs = telemetryState.tracer.startSpan.mock.calls
      .filter((call) => call[0] === "branch.model.call")
      .map((call) => (call[1] as { attributes?: Record<string, unknown> }).attributes);
    expect(modelCallAttrs).toHaveLength(4);
    expect(modelCallAttrs[0]?.["gen_ai.system"]).toBe("openai");
    expect(modelCallAttrs[0]?.["gen_ai.request.model"]).toBe("gpt-5.4");
    expect(modelCallAttrs[0]?.["gen_ai.operation.name"]).toBe("text_completion");
    expect(modelCallAttrs[1]?.["gen_ai.system"]).toBe("google");
    expect(modelCallAttrs[1]?.["gen_ai.request.model"]).toBe("gemini-2.5-flash");
    expect(modelCallAttrs[1]?.["gen_ai.operation.name"]).toBe("generate_content");
    expect(modelCallAttrs[2]?.["gen_ai.system"]).toBe("openai");
    expect(modelCallAttrs[2]?.["gen_ai.request.model"]).toBe("gpt-5.4");
    expect(modelCallAttrs[2]?.["gen_ai.operation.name"]).toBe("chat");
    expect(modelCallAttrs[2]?.["error.type"]).toBe("TimeoutError");
    for (const attrs of [modelCallAttrs[0], modelCallAttrs[2]]) {
      expect(attrs).toMatchObject({
        "branch.model_call.usage.input_tokens": 0,
        "branch.model_call.usage.output_tokens": 0,
        "branch.model_call.usage.cache_read_input_tokens": 0,
        "branch.model_call.usage.cache_creation_input_tokens": 0,
        "branch.model_call.usage.reasoning_output_tokens": 0,
        "branch.model_call.usage.prompt_tokens": 0,
        "branch.model_call.usage.total_tokens": 0,
        "gen_ai.usage.input_tokens": 0,
        "gen_ai.usage.output_tokens": 0,
        "gen_ai.usage.cache_read.input_tokens": 0,
        "gen_ai.usage.cache_creation.input_tokens": 0,
      });
    }
    for (const key of [
      "branch.model_call.request_bytes",
      "branch.model_call.response_bytes",
      "branch.model_call.time_to_first_byte_ms",
    ]) {
      expect(modelCallAttrs[0]).not.toHaveProperty(key);
    }
    expect(
      Object.keys(modelCallAttrs[1] ?? {}).filter(
        (key) => key.startsWith("branch.model_call.usage.") || key.startsWith("gen_ai.usage."),
      ),
    ).toEqual([]);
    expect(modelCallAttrs[3]).toMatchObject({
      "branch.model_call.usage.cache_creation_input_tokens": 7,
      "branch.model_call.usage.prompt_tokens": 7,
      "gen_ai.usage.input_tokens": 7,
      "gen_ai.usage.cache_creation.input_tokens": 7,
    });
    expect(modelCallAttrs[3]).not.toHaveProperty("branch.model_call.usage.input_tokens");
  });

  test("uses latest GenAI request and agent span shapes only when semconv opt-in is set", async () => {
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN = "http,gen_ai_latest_experimental";

    await startServiceFixture(["traces", "metrics"]);

    emitDiagnosticEvent({
      type: "model.call.completed",
      ...MODEL_CALL_FIXTURE,
      api: "openai-completions",
      durationMs: 80,
    });
    emitDiagnosticEvent({
      type: "model.call.completed",
      runId: "run-1",
      callId: "call-2",
      provider: "anthropic",
      model: "claude-opus-4-7",
      api: "claude-code",
      transport: "stdio-live",
      observationUnit: "turn",
      durationMs: 90,
    });
    await emitAndFlush({
      type: "model.usage",
      ...MODEL_FIXTURE,
      usage: { input: 3, output: 2 },
      durationMs: 10,
    });

    expect(startedSpanOptions("branch.model.call")).toBeUndefined();
    const modelCallOptions = startedSpanOptions("text_completion gpt-5.4");
    expect(modelCallOptions?.attributes).toMatchObject({
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-5.4",
      "gen_ai.operation.name": "text_completion",
    });
    expect(Object.hasOwn(modelCallOptions?.attributes ?? {}, "gen_ai.system")).toBe(false);
    expect(modelCallOptions?.startTime).toBeTypeOf("number");
    expect(modelCallOptions?.kind).toBe(2);
    const agentTurnOptions = startedSpanOptions("invoke_agent");
    expect(agentTurnOptions?.attributes).toMatchObject({
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": "claude-opus-4-7",
      "gen_ai.operation.name": "invoke_agent",
      "branch.model_call.observation_unit": "turn",
    });
    expect(agentTurnOptions?.startTime).toBeTypeOf("number");
    expect(agentTurnOptions?.kind).toBe(2);
    const modelUsageOptions = startedSpanOptions("branch.model.usage");
    expect(modelUsageOptions?.attributes).toMatchObject({
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-5.4",
      "gen_ai.operation.name": "chat",
    });
    expect(Object.hasOwn(modelUsageOptions?.attributes ?? {}, "gen_ai.system")).toBe(false);
    expect(modelUsageOptions?.startTime).toBeTypeOf("number");
  });

  test("records upstream request id hashes as model call span events only", async () => {
    await startServiceFixture(["traces", "metrics"]);

    await emitAndFlush({
      type: "model.call.error",
      ...MODEL_CALL_FIXTURE,
      api: "openai-responses",
      durationMs: 40,
      errorCategory: "ProviderError",
      failureKind: "terminated",
      upstreamRequestIdHash: "sha256:123456abcdef",
    });

    const modelCallOptions = startedSpanOptions("branch.model.call");
    expect(modelCallOptions?.attributes?.["branch.failureKind"]).toBe("terminated");
    expect(
      Object.hasOwn(modelCallOptions?.attributes ?? {}, "branch.upstreamRequestIdHash"),
    ).toBe(false);
    expect(modelCallOptions?.startTime).toBeTypeOf("number");
    const span = telemetryState.spans.find((candidate) => candidate.name === "branch.model.call");
    expect(span?.addEvent).toHaveBeenCalledWith("branch.provider.request", {
      "branch.upstreamRequestIdHash": "sha256:123456abcdef",
    });
    const modelCallDuration = lastHistogramRecord("branch.model_call.duration_ms");
    expect(modelCallDuration?.[0]).toBe(40);
    expect(modelCallDuration?.[1]?.["branch.failureKind"]).toBe("terminated");
    expect(Object.hasOwn(modelCallDuration?.[1] ?? {}, "branch.upstreamRequestIdHash")).toBe(
      false,
    );
  });

  test("exports trusted context assembly spans without prompt content", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedEvent("run.started", {
      trace: createTestTrace(SPAN_ID),
    });
    await emitTrustedEventAndFlush("context.assembled", {
      runId: "run-1",
      sessionKey: "session-key",
      sessionId: "session-id",
      ...MODEL_FIXTURE,
      channel: "webchat",
      trigger: "message",
      messageCount: 12,
      historyTextChars: 1234,
      historyImageBlocks: 2,
      maxMessageTextChars: 456,
      systemPromptChars: 789,
      promptChars: 42,
      promptImages: 1,
      contextTokenBudget: 128_000,
      reserveTokens: 4096,
      trace: createTestTrace(GRANDCHILD_SPAN_ID, SPAN_ID),
    });

    const contextCall = startedSpanCall("branch.context.assembled");
    const contextOptions = contextCall?.[1];
    const runSpan = telemetryState.spans.find((span) => span.name === "branch.run");
    const runSpanId = runSpan?.spanContext.mock.results[0]?.value?.spanId;
    expect(contextOptions?.attributes).toMatchObject({
      "branch.provider": "openai",
      "branch.model": "gpt-5.4",
      "branch.channel": "webchat",
      "branch.trigger": "message",
      "branch.context.message_count": 12,
      "branch.context.history_text_chars": 1234,
      "branch.context.history_image_blocks": 2,
      "branch.context.max_message_text_chars": 456,
      "branch.context.system_prompt_chars": 789,
      "branch.context.prompt_chars": 42,
      "branch.context.prompt_images": 1,
      "branch.context.token_budget": 128_000,
      "branch.context.reserve_tokens": 4096,
    });
    expect(contextOptions?.attributes).toBeTypeOf("object");
    expect(contextOptions?.startTime).toBeTypeOf("number");
    expect(JSON.stringify(contextCall)).not.toContain("session-key");
    expect(JSON.stringify(contextCall)).not.toContain("prompt text");
    const linkedSpanContext = firstSetSpanContext();
    expect(linkedSpanContext.traceId).toBe(TRACE_ID);
    expect(linkedSpanContext.spanId).toBe(runSpanId);
    expect(
      (contextCall?.[2] as { spanContext?: { spanId?: string } } | undefined)?.spanContext?.spanId,
    ).toBe(runSpanId);
  });

  test("exports tool loop diagnostics without loop messages or session identifiers", async () => {
    await startServiceFixture(["traces", "metrics"]);

    await emitEventAndFlush("tool.loop", {
      sessionKey: "session-key",
      sessionId: "session-id",
      toolName: "process",
      level: "critical",
      action: "block",
      detector: "known_poll_no_progress",
      count: 20,
      message: "CRITICAL: repeated secret-bearing tool output",
      pairedToolName: "read",
    });

    expect(telemetryState.counters.get("branch.tool.loop")?.add).toHaveBeenCalledWith(1, {
      "branch.toolName": "process",
      "branch.loop.level": "critical",
      "branch.loop.action": "block",
      "branch.loop.detector": "known_poll_no_progress",
      "branch.loop.count": 20,
      "branch.loop.paired_tool": "read",
    });
    const loopSpanCall = startedSpanCall("branch.tool.loop");
    const loopOptions = loopSpanCall?.[1];
    expect(loopOptions?.attributes).toMatchObject({
      "branch.toolName": "process",
      "branch.loop.level": "critical",
      "branch.loop.action": "block",
      "branch.loop.detector": "known_poll_no_progress",
      "branch.loop.count": 20,
      "branch.loop.paired_tool": "read",
    });
    const loopSpan = telemetryState.spans.find((span) => span.name === "branch.tool.loop");
    expect(loopSpan?.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "known_poll_no_progress:block",
    });
    expect(JSON.stringify(loopSpanCall)).not.toContain("session-key");
    expect(JSON.stringify(loopSpanCall)).not.toContain("secret-bearing");
  });

  test("exports diagnostic memory samples and pressure without session identifiers", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitEvent("diagnostic.memory.sample", {
      uptimeMs: 1234,
      memory: {
        rssBytes: 100,
        heapUsedBytes: 40,
        heapTotalBytes: 80,
        externalBytes: 10,
        arrayBuffersBytes: 5,
      },
    });
    await emitEventAndFlush("diagnostic.memory.pressure", {
      level: "critical",
      reason: "rss_growth",
      thresholdBytes: 512,
      rssGrowthBytes: 256,
      windowMs: 60_000,
      memory: {
        rssBytes: 200,
        heapUsedBytes: 50,
        heapTotalBytes: 90,
        externalBytes: 20,
        arrayBuffersBytes: 6,
      },
    });

    expect(telemetryState.histograms.get("branch.memory.rss_bytes")?.record).toHaveBeenCalledWith(
      100,
      {},
    );
    expect(telemetryState.histograms.get("branch.memory.rss_bytes")?.record).toHaveBeenCalledWith(
      200,
      {
        "branch.memory.level": "critical",
        "branch.memory.reason": "rss_growth",
      },
    );
    expect(telemetryState.counters.get("branch.memory.pressure")?.add).toHaveBeenCalledWith(1, {
      "branch.memory.level": "critical",
      "branch.memory.reason": "rss_growth",
    });
    const pressureCall = startedSpanCall("branch.memory.pressure");
    const pressureOptions = pressureCall?.[1];
    expect(pressureOptions?.attributes).toMatchObject({
      "branch.memory.level": "critical",
      "branch.memory.reason": "rss_growth",
      "branch.memory.rss_bytes": 200,
      "branch.memory.heap_used_bytes": 50,
      "branch.memory.heap_total_bytes": 90,
      "branch.memory.external_bytes": 20,
      "branch.memory.array_buffers_bytes": 6,
      "branch.memory.threshold_bytes": 512,
      "branch.memory.rss_growth_bytes": 256,
      "branch.memory.window_ms": 60_000,
    });
    const pressureSpan = telemetryState.spans.find(
      (span) => span.name === "branch.memory.pressure",
    );
    expect(pressureSpan?.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "rss_growth",
    });
    expect(JSON.stringify(pressureCall)).not.toContain("session");
  });

  test("records async diagnostic queue drop summaries", async () => {
    await startServiceFixture(["metrics"]);

    await emitEventAndFlush("diagnostic.async_queue.dropped", {
      droppedEvents: 4,
      droppedTrustedEvents: 1,
      droppedUntrustedEvents: 2,
      droppedPriorityEvents: 1,
      queueLength: 0,
      maxQueueLength: 10_000,
      drainBatchSize: 100,
    });

    const counter = telemetryState.counters.get("branch.diagnostic.async_queue.dropped");
    expect(counter?.add).toHaveBeenCalledWith(4, {
      "branch.diagnostic.async_queue.drop_class": "total",
    });
    expect(counter?.add).toHaveBeenCalledWith(1, {
      "branch.diagnostic.async_queue.drop_class": "trusted",
    });
    expect(counter?.add).toHaveBeenCalledWith(2, {
      "branch.diagnostic.async_queue.drop_class": "untrusted",
    });
    expect(counter?.add).toHaveBeenCalledWith(1, {
      "branch.diagnostic.async_queue.drop_class": "priority",
    });
  });

  test("parents multi-batch late delivery spans from the retained message context", async () => {
    await startServiceFixture(["traces", "metrics"]);

    const messageTrace = createDiagnosticTraceContext(createTestTrace(CHILD_SPAN_ID, SPAN_ID));

    runWithDiagnosticTraceContext(messageTrace, () => {
      logMessageDispatchStarted({
        channel: "slack",
        sessionKey: "agent:main:slack:channel:c1",
        source: "replyResolver",
      });
      for (let index = 0; index < 125; index += 1) {
        emitInternalEvent("message.delivery.completed", {
          channel: "slack",
          deliveryKind: "text",
          sessionKey: `agent:main:slack:channel:c${index}`,
          durationMs: 15,
          resultCount: 1,
        });
      }
      logMessageProcessed({
        channel: "slack",
        sessionKey: "agent:main:slack:channel:c1",
        durationMs: 120,
        outcome: "completed",
      });
    });

    const messageSpan = spanByName("branch.message.processed");
    const messageSpanContext = messageSpan.spanContext();
    expect(messageSpan.end).toHaveBeenCalledTimes(1);
    await waitForDiagnosticEventsDrained();

    const deliveryParentContexts = startedSpanParentContexts("branch.message.delivery");
    expect(deliveryParentContexts).toHaveLength(125);
    expect(deliveryParentContexts.every((parent) => parent?.traceId === TRACE_ID)).toBe(true);
    expect(
      deliveryParentContexts.every((parent) => parent?.spanId === messageSpanContext.spanId),
    ).toBe(true);
  });

  test("correlates skipped duplicate message lifecycle helpers to the active inbound trace", async () => {
    await startServiceFixture(["traces", "metrics"]);

    const messageTrace = createDiagnosticTraceContext(createTestTrace(CHILD_SPAN_ID, SPAN_ID));

    runWithDiagnosticTraceContext(messageTrace, () => {
      logMessageProcessed({
        channel: "slack",
        messageId: "msg-duplicate",
        chatId: "c1",
        sessionKey: "agent:main:slack:channel:c1",
        durationMs: 5,
        outcome: "skipped",
        reason: "duplicate",
      });
    });
    await flushDiagnosticEvents();

    const messageSpan = spanByName("branch.message.processed");
    const messageSpanContext = messageSpan.spanContext();
    const parentContext = startedSpanParentContexts("branch.message.processed")[0];

    expect(messageSpanContext.traceId).toBe(TRACE_ID);
    expect(parentContext?.traceId).toBe(TRACE_ID);
    expect(parentContext?.spanId).toBe(SPAN_ID);
    expect(firstSpanAttributes("branch.message.processed")["branch.reason"]).toBe("duplicate");
    expect(messageSpan.end).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["does not parent sibling active runs through shared upstream aliases", false],
    ["does not parent sibling runs through retained upstream aliases", true],
  ])("%s", async (_name, completeFirstRun) => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedEvent("run.started");
    if (completeFirstRun) {
      emitTrustedEvent("run.completed", {});
    }
    emitTrustedEvent("run.started", {
      runId: "run-2",
      ...MODEL_FIXTURE,
      trace: createTestTrace(GRANDCHILD_SPAN_ID, SPAN_ID),
    });

    const runContexts = startedSpanParentContextsByName("branch.run");

    expect(runContexts).toHaveLength(2);
    expect(runContexts[0]?.parentContext).toBeUndefined();
    expect(runContexts[1]?.parentContext).toBeUndefined();
  });

  test("parents retained upstream alias events only when the owner matches", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedEvent("run.started");
    emitTrustedEvent("model.call.completed", {
      trace: createTestTrace(MODEL_CALL_SPAN_ID, SPAN_ID),
    });
    await emitTrustedEventAndFlush("run.completed", {});

    const runSpanContext = spanByName("branch.run").spanContext();
    const modelParentContext = startedSpanParentContexts("branch.model.call")[0];

    expect(modelParentContext?.traceId).toBe(TRACE_ID);
    expect(modelParentContext?.spanId).toBe(runSpanContext.spanId);
  });

  // Background commands can finish long after run.completed ended the parent span.
  // A missed parent lookup makes OTel mint a fresh trace id, silently splitting the
  // turn into one-span traces, so the link must not depend on elapsed time.
  test.each([
    [
      "branch.model.call",
      {
        type: "model.call.completed",
        ...MODEL_CALL_FIXTURE,
        durationMs: 80,
        trace: createTestTrace(MODEL_CALL_SPAN_ID, CHILD_SPAN_ID),
      },
    ],
  ] as const)(
    "parents late %s spans into the run trace after more than 30 minutes",
    async (spanName, childEvent) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await startServiceFixture(["traces", "metrics"]);

        emitTrustedEvent("run.started");
        const runSpanContext = spanByName("branch.run").spanContext();
        emitTrustedEvent("run.completed");

        vi.setSystemTime(Date.now() + LATE_CHILD_ELAPSED_MS);
        await flushDiagnosticEvents();
        await waitForDiagnosticEventsDrained();
        await flushDiagnosticEvents();

        emitTrustedDiagnosticEvent(childEvent);
        await flushDiagnosticEvents();

        const parentContext = startedSpanParentContexts(spanName)[0];
        expect(parentContext?.traceId).toBe(TRACE_ID);
        expect(parentContext?.spanId).toBe(runSpanContext.spanId);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  // Retained contexts outlive the turn, so this bound is what keeps a long-lived
  // gateway from growing the map without limit.
  test("bounds retained run contexts by evicting the oldest completed runs", async () => {
    await startServiceFixture(["traces", "metrics"]);

    // Each completed run retains its own span id plus its upstream alias, so
    // this comfortably overflows the bound and evicts the earliest run.
    for (let index = 0; index < MAX_RETAINED_TRUSTED_SPAN_CONTEXTS; index += 1) {
      const runId = `run-${index}`;
      const runTrace = createTestTrace(numberedSpanId(index), SPAN_ID);
      emitTrustedEvent("run.started", { runId, trace: runTrace });
      emitTrustedEvent("run.completed", { runId, trace: runTrace });
    }
    const newestRunSpanId = numberedSpanId(MAX_RETAINED_TRUSTED_SPAN_CONTEXTS - 1);
    const newestRunSpan = telemetryState.spans.findLast((span) => span.name === "branch.run");
    telemetryState.tracer.startSpan.mockClear();

    emitTrustedEvent("model.usage", {
      trace: createTestTrace(GRANDCHILD_SPAN_ID, newestRunSpanId),
    });
    emitTrustedEvent("model.usage", {
      trace: createTestTrace(MODEL_USAGE_SPAN_ID, numberedSpanId(0)),
    });

    const usageParents = startedSpanParentContexts("branch.model.usage");
    expect(usageParents[0]?.spanId).toBe(newestRunSpan?.spanContext().spanId);
    expect(usageParents[1]).toBeUndefined();
  });

  test("does not create live started spans for untrusted lifecycle diagnostics", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitEvent("run.started", {}, ["trace"]);
    emitEvent("run.completed", {}, ["trace"]);
    emitEvent("model.call.started", {}, ["trace"]);
    emitEvent("model.call.completed", {}, ["trace"]);
    emitEvent("tool.execution.started", {}, ["trace"]);
    emitEvent("tool.execution.error", {}, ["trace"]);
    emitDiagnosticEvent({
      type: "harness.run.started",
      runId: "run-1",
      provider: "codex",
      model: "gpt-5.4",
      harnessId: "codex",
      pluginId: "codex-plugin",
    });
    await emitAndFlush({
      type: "harness.run.completed",
      runId: "run-1",
      provider: "codex",
      model: "gpt-5.4",
      harnessId: "codex",
      pluginId: "codex-plugin",
      outcome: "completed",
      durationMs: 90,
    });

    expect(
      telemetryState.tracer.startSpan.mock.calls.filter((call) => call[0] === "branch.run"),
    ).toHaveLength(1);
    expect(
      telemetryState.tracer.startSpan.mock.calls.filter(
        (call) => call[0] === "branch.model.call",
      ),
    ).toHaveLength(1);
    expect(
      telemetryState.tracer.startSpan.mock.calls.filter(
        (call) => call[0] === "branch.tool.execution",
      ),
    ).toHaveLength(1);
    expect(
      telemetryState.tracer.startSpan.mock.calls.filter(
        (call) => call[0] === "branch.harness.run",
      ),
    ).toHaveLength(1);
  });

  // Exec spans used to always be roots, which stranded every shell command in its
  // own single-span trace instead of nesting it under the run that spawned it.
  test("nests exec spans under the run when the trace context is Branch-owned", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedEvent("run.started");
    const runSpanContext = spanByName("branch.run").spanContext();
    const execEvent = {
      type: "exec.process.completed",
      target: "host",
      mode: "child",
      outcome: "completed",
      durationMs: 30,
      commandLength: 12,
      // Exec carries the ambient run scope, so its own span id is the run's.
      trace: createTestTrace(CHILD_SPAN_ID, SPAN_ID),
    } as const;

    emitDiagnosticEventWithTrustedTraceContext(execEvent);
    emitDiagnosticEvent(execEvent);
    await flushDiagnosticEvents();

    const execParents = startedSpanParentContexts("branch.exec");
    expect(execParents[0]?.traceId).toBe(TRACE_ID);
    expect(execParents[0]?.spanId).toBe(runSpanContext.spanId);
    // A plain untrusted emitter must not be able to inject a parent link.
    expect(execParents[1]).toBeUndefined();
  });

  test("exports exec process spans without command text", async () => {
    await startServiceFixture(["traces", "metrics"]);

    await emitEventAndFlush("exec.process.completed", {
      target: "host",
      mode: "child",
      outcome: "failed",
      durationMs: 30,
      commandLength: 42,
      exitCode: 1,
      timedOut: false,
      failureKind: "runtime-error",
    });

    const execDuration = lastHistogramRecord("branch.exec.duration_ms");
    expect(execDuration?.[0]).toBe(30);
    expect(execDuration?.[1]?.["branch.exec.target"]).toBe("host");
    expect(execDuration?.[1]?.["branch.exec.mode"]).toBe("child");
    expect(execDuration?.[1]?.["branch.outcome"]).toBe("failed");
    expect(execDuration?.[1]?.["branch.failureKind"]).toBe("runtime-error");

    const execCall = startedSpanCall("branch.exec");
    const execOptions = execCall?.[1];
    expect(execOptions?.attributes).toMatchObject({
      "branch.exec.target": "host",
      "branch.exec.mode": "child",
      "branch.outcome": "failed",
      "branch.exec.command_length": 42,
      "branch.exec.exit_code": 1,
      "branch.exec.timed_out": false,
      "branch.failureKind": "runtime-error",
    });
    expect(Object.hasOwn(execOptions?.attributes ?? {}, "branch.exec.command")).toBe(false);
    expect(Object.hasOwn(execOptions?.attributes ?? {}, "branch.exec.workdir")).toBe(false);
    expect(Object.hasOwn(execOptions?.attributes ?? {}, "branch.sessionKey")).toBe(false);
    expect(execOptions?.startTime).toBeTypeOf("number");

    const execSpan = spanByName("branch.exec");
    expect(execSpan?.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "runtime-error",
    });
    expect(firstSpanEndTime("branch.exec")).toBeTypeOf("number");
  });

  test("exports message delivery spans and metrics with low-cardinality attributes", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitEvent("message.delivery.started", {
      channel: "matrix",
      deliveryKind: "text",
      sessionKey: "session-secret",
    });
    emitEvent("message.delivery.completed", {
      channel: "matrix",
      deliveryKind: "text",
      durationMs: 25,
      resultCount: 1,
      sessionKey: "session-secret",
    });
    await emitEventAndFlush("message.delivery.error", {
      channel: "discord",
      deliveryKind: "media",
      durationMs: 40,
      errorCategory: "TypeError",
      sessionKey: "session-secret",
    });

    expect(
      telemetryState.counters.get("branch.message.delivery.started")?.add,
    ).toHaveBeenCalledWith(1, {
      "branch.channel": "matrix",
      "branch.delivery.kind": "text",
    });
    const deliveryDurationRecords = telemetryState.histograms.get(
      "branch.message.delivery.duration_ms",
    )?.record.mock.calls as Array<[unknown, Record<string, unknown>]>;
    expect(deliveryDurationRecords[0]?.[0]).toBe(25);
    expect(deliveryDurationRecords[0]?.[1]["branch.channel"]).toBe("matrix");
    expect(deliveryDurationRecords[0]?.[1]["branch.delivery.kind"]).toBe("text");
    expect(deliveryDurationRecords[0]?.[1]["branch.outcome"]).toBe("completed");
    expect(deliveryDurationRecords[1]?.[0]).toBe(40);
    expect(deliveryDurationRecords[1]?.[1]["branch.channel"]).toBe("discord");
    expect(deliveryDurationRecords[1]?.[1]["branch.delivery.kind"]).toBe("media");
    expect(deliveryDurationRecords[1]?.[1]["branch.outcome"]).toBe("error");
    expect(deliveryDurationRecords[1]?.[1]["branch.errorCategory"]).toBe("TypeError");

    const deliverySpanCalls = telemetryState.tracer.startSpan.mock.calls.filter(
      (call) => call[0] === "branch.message.delivery",
    );
    expect(deliverySpanCalls).toHaveLength(2);
    const firstDeliveryOptions = deliverySpanCalls[0]?.[1] as
      | { attributes?: Record<string, unknown>; startTime?: unknown }
      | undefined;
    expect(firstDeliveryOptions?.attributes).toMatchObject({
      "branch.channel": "matrix",
      "branch.delivery.kind": "text",
      "branch.outcome": "completed",
      "branch.delivery.result_count": 1,
    });
    expect(firstDeliveryOptions?.startTime).toBeTypeOf("number");
    const secondDeliveryOptions = deliverySpanCalls[1]?.[1] as
      | { attributes?: Record<string, unknown>; startTime?: unknown }
      | undefined;
    expect(secondDeliveryOptions?.attributes).toMatchObject({
      "branch.channel": "discord",
      "branch.delivery.kind": "media",
      "branch.outcome": "error",
      "branch.errorCategory": "TypeError",
    });
    expect(secondDeliveryOptions?.startTime).toBeTypeOf("number");
    for (const call of deliverySpanCalls) {
      const options = call[1] as { attributes?: Record<string, unknown>; startTime?: unknown };
      expect(Object.hasOwn(options.attributes ?? {}, "branch.chatId")).toBe(false);
      expect(Object.hasOwn(options.attributes ?? {}, "branch.sessionKey")).toBe(false);
      expect(Object.hasOwn(options.attributes ?? {}, "branch.messageId")).toBe(false);
      expect(Object.hasOwn(options.attributes ?? {}, "branch.conversationId")).toBe(false);
      expect(Object.hasOwn(options.attributes ?? {}, "branch.content")).toBe(false);
      expect(Object.hasOwn(options.attributes ?? {}, "branch.to")).toBe(false);
      expect(options.startTime).toBeTypeOf("number");
    }
    const errorSpan = telemetryState.spans.find(
      (span) => span.name === "branch.message.delivery" && span.setStatus.mock.calls.length > 0,
    );
    expect(errorSpan?.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "TypeError",
    });
  });

  test("exports session recovery and talk metrics with bounded attributes", async () => {
    await startServiceFixture(["metrics"]);

    emitTrustedEvent("session.recovery.requested", {
      sessionId: "session-should-not-export",
      sessionKey: "key-should-not-export",
      state: "processing",
      ageMs: 12_000,
      reason: "startup-sweep",
      activeWorkKind: "tool_call",
      allowActiveAbort: true,
    });
    emitTrustedEvent("session.recovery.completed", {
      sessionId: "session-should-not-export",
      sessionKey: "key-should-not-export",
      state: "processing",
      ageMs: 13_000,
      reason: "startup-sweep",
      activeWorkKind: "tool_call",
      status: "released",
      action: "abort-active-run",
    });
    emitTrustedEvent("talk.event", {
      sessionId: "talk-session-should-not-export",
      turnId: "turn-should-not-export",
      talkEventType: "input.audio.delta",
      mode: "realtime",
      transport: "gateway-relay",
      brain: "agent-consult",
      provider: "openai",
      byteLength: 320,
    });
    await emitTrustedEventAndFlush("talk.event", {
      sessionId: "talk-session-should-not-export",
      talkEventType: "latency.metrics",
      mode: "realtime",
      transport: "gateway-relay",
      brain: "agent-consult",
      provider: "openai",
      durationMs: 45,
    });

    const recoveryRequestedCall = firstCounterAddCall("branch.session.recovery.requested");
    expect(recoveryRequestedCall[0]).toBe(1);
    expect(recoveryRequestedCall[1]?.["branch.state"]).toBe("processing");
    expect(recoveryRequestedCall[1]?.["branch.action"]).toBe("abort");
    expect(recoveryRequestedCall[1]?.["branch.active_work_kind"]).toBe("tool_call");
    const recoveryCompletedCall = firstCounterAddCall("branch.session.recovery.completed");
    expect(recoveryCompletedCall[0]).toBe(1);
    expect(recoveryCompletedCall[1]?.["branch.state"]).toBe("processing");
    expect(recoveryCompletedCall[1]?.["branch.status"]).toBe("released");
    expect(recoveryCompletedCall[1]?.["branch.action"]).toBe("abort-active-run");
    const recoveryAgeRecord = lastHistogramRecord("branch.session.recovery.age_ms");
    expect(recoveryAgeRecord?.[0]).toBe(13_000);
    expect(recoveryAgeRecord?.[1]?.["branch.status"]).toBe("released");
    expect(telemetryState.counters.get("branch.talk.event")?.add).toHaveBeenCalledWith(1, {
      "branch.talk.brain": "agent-consult",
      "branch.talk.event_type": "input.audio.delta",
      "branch.talk.mode": "realtime",
      "branch.talk.provider": "openai",
      "branch.talk.transport": "gateway-relay",
    });
    expect(telemetryState.histograms.get("branch.talk.audio.bytes")?.record).toHaveBeenCalledWith(
      320,
      {
        "branch.talk.brain": "agent-consult",
        "branch.talk.event_type": "input.audio.delta",
        "branch.talk.mode": "realtime",
        "branch.talk.provider": "openai",
        "branch.talk.transport": "gateway-relay",
      },
    );
    expect(
      telemetryState.histograms.get("branch.talk.event.duration_ms")?.record,
    ).toHaveBeenCalledWith(45, {
      "branch.talk.brain": "agent-consult",
      "branch.talk.event_type": "latency.metrics",
      "branch.talk.mode": "realtime",
      "branch.talk.provider": "openai",
      "branch.talk.transport": "gateway-relay",
    });

    const talkCounterCalls = JSON.stringify(
      telemetryState.counters.get("branch.talk.event")?.add.mock.calls,
    );
    expect(talkCounterCalls).not.toContain("talk-session-should-not-export");
    expect(talkCounterCalls).not.toContain("turn-should-not-export");
  });

  test("does not export model or tool content unless capture is explicitly enabled", async () => {
    await startServiceFixture(["traces", "metrics"]);

    emitTrustedModelCallCompletedWithContent({
      inputMessages: ["private user prompt"],
      outputMessages: ["private model reply"],
      systemPrompt: "private system prompt",
    });
    emitTrustedToolExecutionCompletedWithContent(
      {
        toolInput: "private tool input",
        toolOutput: "private tool output",
      },
      {
        toolCallId: "tool-1",
      },
    );
    await flushDiagnosticEvents();

    const modelOptions = startedSpanOptions("branch.model.call");
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "branch.content.input_messages")).toBe(
      false,
    );
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "branch.content.output_messages")).toBe(
      false,
    );
    expect(Object.hasOwn(modelOptions?.attributes ?? {}, "branch.content.system_prompt")).toBe(
      false,
    );
    expect(modelOptions?.startTime).toBeTypeOf("number");
    const toolOptions = startedSpanOptions("branch.tool.execution");
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "branch.content.tool_input")).toBe(false);
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "branch.content.tool_output")).toBe(
      false,
    );
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "gen_ai.tool.call.arguments")).toBe(false);
    expect(Object.hasOwn(toolOptions?.attributes ?? {}, "gen_ai.tool.call.result")).toBe(false);
    expect(toolOptions?.attributes).toMatchObject({
      "gen_ai.tool.call.id": "tool-1",
      "gen_ai.operation.name": "execute_tool",
    });
    expect(toolOptions?.startTime).toBeTypeOf("number");
  });

  test("exports bounded redacted content when capture is enabled", async () => {
    await startServiceFixture(["traces", "metrics"], {
      captureContent: true,
    });

    emitTrustedModelCallCompletedWithContent({
      inputMessages: ["use key sk-1234567890abcdef1234567890abcdef"], // pragma: allowlist secret
      outputMessages: ["model reply"],
      systemPrompt: "system prompt",
    });
    emitTrustedToolExecutionCompletedWithContent(
      {
        toolInput: "tool input",
        toolOutput: `${"x".repeat(4077)} Bearer ${"a".repeat(80)}`, // pragma: allowlist secret
      },
      {
        toolCallId: "tool-1",
      },
    );
    await flushDiagnosticEvents();

    const modelAttrs = startedSpanOptions("branch.model.call")?.attributes;
    const toolAttrs = startedSpanOptions("branch.tool.execution")?.attributes;

    expect(modelAttrs?.["branch.content.output_messages"]).toBe("model reply");
    expect(Object.hasOwn(modelAttrs ?? {}, "branch.content.system_prompt")).toBe(false);
    expect(String(modelAttrs?.["branch.content.input_messages"])).not.toContain(
      "sk-1234567890abcdef1234567890abcdef", // pragma: allowlist secret
    );
    expect(toolAttrs).toMatchObject({
      "branch.content.tool_input": "tool input",
      "gen_ai.tool.call.id": "tool-1",
      "gen_ai.operation.name": "execute_tool",
    });
    expect(toolAttrs?.["gen_ai.tool.call.arguments"]).toBe(
      toolAttrs?.["branch.content.tool_input"],
    );
    expect(typeof toolAttrs?.["branch.content.tool_output"]).toBe("string");
    expect(String(toolAttrs?.["branch.content.tool_output"]).length).toBeLessThanOrEqual(
      MAX_TEST_OTEL_CONTENT_ATTRIBUTE_CHARS + OTEL_TRUNCATED_SUFFIX_MAX_CHARS,
    );
    expect(String(toolAttrs?.["branch.content.tool_output"])).not.toContain("a".repeat(11));
    expect(toolAttrs?.["gen_ai.tool.call.result"]).toBe(
      toolAttrs?.["branch.content.tool_output"],
    );
  });

  test("exports Phoenix-readable GenAI prompt, output, and tool definition attributes", async () => {
    const attrs = await captureModelContent({
      inputMessages: [
        { role: "user", content: "what changed?", timestamp: 1 },
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "lookup",
              arguments: { q: "trace" },
              extraField: "leaked",
            },
          ],
        },
        { role: "toolResult", toolCallId: "call-1", content: { rows: 1 } },
      ],
      outputMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "the trace changed" }],
          stopReason: "stop",
        },
      ],
      systemPrompt: "be exact",
      toolDefinitions: [
        { name: "lookup", description: "Lookup data", parameters: { type: "object" } },
      ],
    });

    expect(Object.hasOwn(attrs ?? {}, "gen_ai.system_instructions")).toBe(false);
    expect(JSON.parse(stringAttribute(attrs, "gen_ai.input.messages"))).toEqual([
      { role: "user", parts: [{ type: "text", content: "what changed?" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "call-1",
            name: "lookup",
            arguments: { q: "trace" },
          },
        ],
      },
      {
        role: "tool",
        parts: [{ type: "tool_call_response", id: "call-1", response: { rows: 1 } }],
      },
    ]);
    expect(JSON.parse(stringAttribute(attrs, "gen_ai.output.messages"))).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: "the trace changed" }],
        finish_reason: "stop",
      },
    ]);
    expect(JSON.parse(stringAttribute(attrs, "gen_ai.tool.definitions"))).toEqual([
      {
        type: "function",
        name: "lookup",
        description: "Lookup data",
        parameters: { type: "object" },
      },
    ]);
    expect(attrs).toMatchObject({
      "input.mime_type": "application/json",
      "output.mime_type": "application/json",
    });
  });

  test("never exports provider-internal thinking payloads in model message attributes", async () => {
    const attrs = await captureModelContent(
      {
        inputMessages: [
          {
            role: "assistant",
            reasoning_content: "input-message-internal-canary",
            reasoning_details: [{ text: "input-details-internal-canary" }],
            content: [
              { type: "thinking", thinking: "input-internal-canary" },
              { type: "reasoning", content: "input-part-internal-canary" },
              {
                type: "text",
                text: "visible input",
                textSignature: "input-text-signature-internal-canary",
              },
            ],
          },
        ],
        outputMessages: [
          {
            role: "assistant",
            reasoning: "output-message-internal-canary",
            reasoning_text: "output-text-internal-canary",
            content: [
              { type: "redacted_thinking", data: "output-internal-canary" },
              { type: "text", text: "visible output" },
              {
                type: "toolCall",
                id: "tool-1",
                name: "lookup",
                arguments: { query: "visible" },
                thoughtSignature: "output-thought-signature-internal-canary",
              },
            ],
          },
        ],
      },
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      },
    );

    const internalCanaries = [
      "input-internal-canary",
      "input-message-internal-canary",
      "input-details-internal-canary",
      "input-part-internal-canary",
      "output-internal-canary",
      "output-message-internal-canary",
      "output-text-internal-canary",
      "input-text-signature-internal-canary",
      "output-thought-signature-internal-canary",
    ];
    for (const key of [
      "gen_ai.input.messages",
      "gen_ai.output.messages",
      "branch.content.input_messages",
      "branch.content.output_messages",
    ]) {
      const value = stringAttribute(attrs, key);
      for (const canary of internalCanaries) {
        expect(value).not.toContain(canary);
      }
    }
    expect(JSON.parse(stringAttribute(attrs, "gen_ai.input.messages"))[0]?.parts).toEqual([
      { type: "text", content: "visible input" },
    ]);
    expect(JSON.parse(stringAttribute(attrs, "gen_ai.output.messages"))[0]?.parts).toEqual([
      { type: "text", content: "visible output" },
      {
        type: "tool_call",
        id: "tool-1",
        name: "lookup",
        arguments: { query: "visible" },
      },
    ]);
    expect(
      JSON.parse(stringAttribute(attrs, "branch.content.input_messages"))[0]?.content[0],
    ).toEqual({ type: "reasoning", redacted: true });
    expect(
      JSON.parse(stringAttribute(attrs, "branch.content.input_messages"))[0]?.content[1],
    ).toEqual({ type: "reasoning", redacted: true });
    expect(
      JSON.parse(stringAttribute(attrs, "branch.content.output_messages"))[0]?.content[0],
    ).toEqual({ type: "reasoning", redacted: true });
    expect(
      JSON.parse(stringAttribute(attrs, "branch.content.input_messages"))[0]?.content[2],
    ).toEqual({ type: "text", text: "visible input" });
    expect(
      JSON.parse(stringAttribute(attrs, "branch.content.output_messages"))[0]?.content[2],
    ).toEqual({
      type: "toolCall",
      id: "tool-1",
      name: "lookup",
      arguments: { query: "visible" },
    });
  });

  test("emits semconv response text for tool response parts", async () => {
    const attrs = await captureModelContent({
      inputMessages: [
        {
          role: "tool",
          parts: [
            {
              type: "tool_call_response",
              id: "call-1",
              result: [
                { type: "text", text: "first line" },
                { type: "text", text: "second line" },
              ],
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call-2",
          content: [
            { type: "text", text: "alpha" },
            { type: "text", text: "beta" },
          ],
        },
      ],
    });

    expect(JSON.parse(stringAttribute(attrs, "gen_ai.input.messages"))).toEqual([
      {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id: "call-1",
            response: "first line\nsecond line",
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id: "call-2",
            response: "alpha\nbeta",
          },
        ],
      },
    ]);
  });

  test("flattens oversized pure-text tool results with a truncation marker", async () => {
    const textParts = Array.from({ length: 201 }, (_, index) => ({
      type: "text",
      text: `line-${index}`,
    }));
    const attrs = await captureModelContent({
      inputMessages: [{ role: "toolResult", toolCallId: "call-1", content: textParts }],
    });

    const messages = JSON.parse(stringAttribute(attrs, "gen_ai.input.messages")) as {
      parts: { response?: unknown }[];
    }[];
    const expected = `${textParts
      .slice(0, 200)
      .map((part) => part.text)
      .join("\n")}\n...(1 more text parts omitted)`;
    expect(messages[0]?.parts[0]?.response).toBe(expected);
  });

  test("keeps single oversized GenAI messages and tool definitions parseable", async () => {
    // The 8,192-character candidate budget leaves an 8,178-character text prefix;
    // place a surrogate pair across that boundary so serialized JSON must stay valid.
    const surrogateBoundaryPrefix = "x".repeat(8177);
    const attrs = await captureModelContent({
      inputMessages: [
        {
          role: "user",
          content: `${surrogateBoundaryPrefix}🚀${"y".repeat(
            MAX_TEST_OTEL_CONTENT_ATTRIBUTE_CHARS,
          )}`,
        },
      ],
      toolDefinitions: [
        {
          name: "huge_schema",
          description: "Huge schema",
          parameters: {
            type: "object",
            properties: {
              payload: {
                type: "string",
                description: "x".repeat(MAX_TEST_OTEL_CONTENT_ATTRIBUTE_CHARS),
              },
            },
          },
        },
      ],
    });

    const genAiInput = stringAttribute(attrs, "gen_ai.input.messages");
    const toolDefinitions = stringAttribute(attrs, "gen_ai.tool.definitions");
    expect(genAiInput.length).toBeLessThanOrEqual(MAX_TEST_OTEL_CONTENT_ATTRIBUTE_CHARS);
    expect(toolDefinitions.length).toBeLessThanOrEqual(MAX_TEST_OTEL_CONTENT_ATTRIBUTE_CHARS);
    expect(genAiInput).not.toContain("\\ud83d");
    expect(JSON.parse(genAiInput)).toEqual([
      {
        role: "user",
        parts: [
          {
            type: "text",
            content: `${surrogateBoundaryPrefix}...(truncated)`,
          },
        ],
      },
    ]);
    expect(JSON.parse(toolDefinitions)[0]).toMatchObject({
      type: "function",
      name: "huge_schema",
      parameters: {
        type: "object",
      },
    });
  });

  test("redacts sensitive reason in session.state metric attributes", async () => {
    await startServiceFixture(["metrics"]);

    emitDiagnosticEvent({
      type: "session.state",
      state: "waiting",
      reason: "token=ghp_abcdefghijklmnopqrstuvwxyz123456", // pragma: allowlist secret
    });

    const sessionStateCall = firstCounterAddCall("branch.session.state");
    const attrs = sessionStateCall[1];
    expect(sessionStateCall[0]).toBe(1);
    expect(String(attrs?.["branch.reason"])).toContain("…");
    expect(typeof attrs?.["branch.reason"]).toBe("string");
    expect(String(attrs?.["branch.reason"])).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz123456", // pragma: allowlist secret
    );
  });
  test("exports trusted security events as stdout JSONL logs", async () => {
    await startOtelService({ endpoint: "", logs: true, logsExporter: "stdout" });
    const trace = createDiagnosticTraceContext(createTestTrace(SPAN_ID));
    const stdout = captureStdoutWrites();

    try {
      emitTrustedSecurityEvent({
        eventId: "security-event-stdout",
        category: "tool",
        action: "tool.execution.blocked",
        outcome: "denied",
        severity: "medium",
        reason: "tools.deny",
        attributes: {
          secretish: "token sk-test-secret",
          [PROTO_KEY]: "blocked",
        },
        trace,
      });
      await flushDiagnosticEvents();

      expect(logExporterCtor).not.toHaveBeenCalled();
      expect(logEmit).not.toHaveBeenCalled();
      const record = parseSingleStdoutDiagnosticLogLine(stdout.writes);
      expect(record.body).toBe("branch.security.event");
      expect(record.severityText).toBe("WARN");
      expect(record.severityNumber).toBe(13);
      expect(record.attributes).toMatchObject({
        "branch.security.event_id": "security-event-stdout",
        "branch.security.category": "tool",
        "branch.security.action": "tool.execution.blocked",
        "branch.security.outcome": "denied",
        "branch.security.severity": "medium",
        "branch.security.reason": "tools.deny",
        "branch.security.attribute.secretish": "unknown",
      });
      expect(Object.hasOwn(record.attributes ?? {}, "branch.security.attribute.__proto__")).toBe(
        false,
      );
      expect(record.trace_id).toBe(TRACE_ID);
      expect(record.span_id).toBe(SPAN_ID);
      expect(record.trace_flags).toBe("01");
      expect(JSON.stringify(record)).not.toContain("sk-test-secret");
    } finally {
      stdout.spy.mockRestore();
    }
  });

  test("drops session-shaped queue lanes from model failover spans", async () => {
    await startServiceFixture(["traces"]);

    await emitEventAndFlush("model.failover", {
      lane: "session:Agent:qa:otel-trace-smoke",
      reason: "overloaded",
      fromProvider: "anthropic",
      fromModel: "claude-opus-4-6",
    });

    const failoverOptions = startedSpanOptions("branch.model.failover");
    expect(failoverOptions?.attributes?.["branch.lane"]).toBe("session");
    expect(JSON.stringify(failoverOptions?.attributes)).not.toContain("Agent:qa:otel-trace-smoke");
  });
});
/* oxlint-disable max-lines -- TODO: split this grandfathered oversized file. */
