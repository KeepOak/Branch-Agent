import { asNonNegativeFiniteNumber as numericValue } from "branch/plugin-sdk/number-runtime";
import type { DiagnosticEventPayload } from "../api.js";
import type { PrometheusMetricStore } from "./prometheus-metric-store.js";

export function recordMemorySample(
  store: PrometheusMetricStore,
  memory: Extract<DiagnosticEventPayload, { type: "diagnostic.memory.sample" }>["memory"],
  byteBuckets: number[],
): void {
  for (const worker of memory.workerLifecycle ?? []) {
    store.counterValue(
      "branch_worker_started_total",
      "Worker isolates created by bounded script basename.",
      { script: worker.script },
      worker.started,
    );
    for (const { reason, count } of worker.retired) {
      store.counterValue(
        "branch_worker_retired_total",
        "Worker isolates confirmed exited by owner retirement reason.",
        { script: worker.script, reason },
        count,
      );
    }
  }
  for (const [kind, field] of [
    ["rss", "rssBytes"],
    ["heap_total", "heapTotalBytes"],
    ["heap_used", "heapUsedBytes"],
    ["external", "externalBytes"],
    ["array_buffers", "arrayBuffersBytes"],
    ["worker_heap_total", "workerHeapTotalBytes"],
    ["worker_heap_used", "workerHeapUsedBytes"],
  ] as const) {
    store.gauge(
      "branch_memory_bytes",
      "Latest process memory usage by memory kind.",
      { kind },
      numericValue(memory[field]),
    );
  }
  for (const [name, field] of [
    ["branch_worker_count", "workerCount"],
    ["branch_worker_heap_sampled_count", "workerHeapSampledCount"],
  ] as const) {
    store.gauge(name, "Worker isolate counts.", {}, numericValue(memory[field]));
  }
  // The resource owner supplies bounded script names and retires stale/exit samples.
  const workerHeaps = new Map<string, number>();
  for (const worker of memory.workerHeaps ?? []) {
    const heapUsed = numericValue(worker.heapUsed);
    if (heapUsed !== undefined) {
      workerHeaps.set(worker.script, (workerHeaps.get(worker.script) ?? 0) + heapUsed);
    }
  }
  store.clearGauges("branch_worker_heap_used_bytes");
  for (const [script, heapUsed] of workerHeaps) {
    store.gauge(
      "branch_worker_heap_used_bytes",
      "Latest live Worker heap usage by bounded script basename.",
      { script },
      heapUsed,
    );
  }
  store.histogram(
    "branch_memory_rss_bytes",
    "RSS memory sample distribution in bytes.",
    {},
    numericValue(memory.rssBytes),
    byteBuckets,
  );
}
