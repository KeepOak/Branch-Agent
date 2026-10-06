// Written by Branch for OBSERVABILITY-0001 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/diagnostics-otel/src/service.ts; not copied. Exercises the real OTLP exporters.
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { expect, test } from "vitest";
import { installRealOtelSdkTestHarness, PRELOAD_ENV } from "./service.real-sdk.test-support.js";
import { emitRealSdkSignals, startOtelService, startOtlpReceiver } from "./service.test-helpers.js";

installRealOtelSdkTestHarness();

test.each(["config", "environment"])(
  "exports traces, metrics and logs to the owner collector from %s",
  async (source) => {
    const receiver = await startOtlpReceiver();
    context.disable();
    metrics.disable();
    propagation.disable();
    trace.disable();
    logs.disable();
    process.env[PRELOAD_ENV] = "0";
    const { service, ctx } = await startOtelService({
      endpoint: receiver.endpoint,
      traces: true,
      metrics: true,
      logs: true,
      configure: (serviceContext) => {
        if (source === "environment") {
          delete serviceContext.config.diagnostics!.otel!.endpoint;
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.endpoint;
        }
      },
    });
    try {
      await emitRealSdkSignals();
      await service.stop?.(ctx);
      expect(new Set(receiver.requests.map(({ url }) => url))).toEqual(
        new Set(["/v1/traces", "/v1/metrics", "/v1/logs"]),
      );
      for (const request of receiver.requests) {
        expect(request.method).toBe("POST");
        expect(request.contentType).toBe("application/x-protobuf");
      }
    } finally {
      await service.stop?.(ctx);
      await receiver.close();
    }
  },
  30_000,
);
