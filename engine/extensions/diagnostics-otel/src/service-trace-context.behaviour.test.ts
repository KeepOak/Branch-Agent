// Written by Branch for OBSERVABILITY-0004 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/diagnostics-otel/src/service-trace-context.ts; not copied. Uses real W3C propagation and the host tracer.
import { ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { expect, test } from "vitest";
import {
  contextForTraceContext,
  normalizedTrustedTraceContext,
  normalizeTraceContext,
} from "./service-trace-context.js";

const remote = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  traceFlags: "01",
};

test("continues the remote W3C parent inside a host tracer and propagates the child", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  try {
    const parent = contextForTraceContext(normalizeTraceContext(remote));
    expect(trace.getSpanContext(parent!)).toEqual({
      traceId: remote.traceId,
      spanId: remote.spanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
    const span = provider.getTracer("harvest-host").startSpan("branch-request", {}, parent);
    const carrier: Record<string, string> = {};
    const propagator = new W3CTraceContextPropagator();
    propagator.inject(trace.setSpan(ROOT_CONTEXT, span), carrier, {
      set: (target, key, value) => {
        target[key] = value;
      },
    });
    expect(carrier.traceparent).toBe(`00-${remote.traceId}-${span.spanContext().spanId}-01`);
    const extracted = propagator.extract(ROOT_CONTEXT, carrier, {
      keys: (target) => Object.keys(target),
      get: (target, key) => target[key],
    });
    expect(trace.getSpanContext(extracted)?.traceId).toBe(remote.traceId);
    span.end();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(exporter.getFinishedSpans()[0]?.parentSpanContext?.spanId).toBe(remote.spanId);
  } finally {
    await provider.shutdown();
  }
});

test("correlates logs only with trusted payloads or a trusted host scope", () => {
  const event = {
    type: "log.record" as const,
    seq: 1,
    ts: 1,
    level: "INFO",
    message: "request",
    trace: remote,
  };
  expect(normalizedTrustedTraceContext(event, { trusted: false })).toBeUndefined();
  expect(normalizedTrustedTraceContext(event, { trusted: true })).toEqual(remote);
  expect(
    normalizedTrustedTraceContext(event, { trusted: false, trustedTraceContext: true }),
  ).toEqual(remote);
});

test.each([
  { ...remote, traceId: "00000000000000000000000000000000" },
  { ...remote, spanId: "0000000000000000" },
  { ...remote, traceFlags: "invalid" },
])("rejects invalid trace context $traceId/$spanId/$traceFlags", (invalid) => {
  expect(normalizeTraceContext(invalid)).toBeUndefined();
});
