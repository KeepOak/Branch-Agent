import assert from "node:assert/strict";
import { test } from "node:test";
import "./source-native-test-loader.mts";

const first = await import("./source-streaming-context.ts?copy=1");
const second = await import("./source-streaming-context.ts?copy=2");

// Three source cases from eliza's streaming-context.test.ts, adapted to Node.
test("shares one context manager between copies", async () => {
  assert.notEqual(first, second);
  assert.equal(second.getStreamingContextManager(), first.getStreamingContextManager());
  await first.runWithStreamingContext({ messageId: "turn-1" }, async () => {
    await Promise.resolve();
    assert.equal(second.getStreamingContext()?.messageId, "turn-1");
  });
});

test("makes a manager override visible to every copy", () => {
  const original = first.getStreamingContextManager();
  try {
    second.setStreamingContextManager({ run: (_context, fn) => fn(), active: () => ({ messageId: "override" }) });
    assert.equal(first.getStreamingContext()?.messageId, "override");
  } finally { second.setStreamingContextManager(original); }
});

test("shares model stream chunk delivery depth between copies", async () => {
  await first.runInsideModelStreamChunkDelivery(async () => {
    await Promise.resolve();
    assert.equal(second.getModelStreamChunkDeliveryDepth(), 1);
  });
  assert.equal(first.getModelStreamChunkDeliveryDepth(), 0);
});

test("concurrent turns keep callback and cancellation identity", async () => {
  const seen: string[] = [];
  const controllers = [new AbortController(), new AbortController()];
  await Promise.all(controllers.map((controller, index) => first.runWithStreamingContext({
    messageId: String(index), abortSignal: controller.signal,
    onAgentEvent: () => { seen.push(String(index)); },
  }, async () => {
    await Promise.resolve();
    assert.equal(second.getStreamingContext()?.abortSignal, controller.signal);
    assert.equal(second.getStreamingContext()?.messageId, String(index));
    await second.emitStreamingEvent(second.getStreamingContext(), { stream: "lifecycle", data: {} });
  })));
  assert.deepEqual(seen.sort(), ["0", "1"]);
  assert.equal(first.getStreamingContext(), undefined);
});

test("suppression detaches tokens while retaining cancellation and events", async () => {
  const controller = new AbortController();
  let chunks = 0;
  let events = 0;
  await first.runWithStreamingContext({ messageId: "turn", abortSignal: controller.signal,
    onStreamChunk: () => { chunks++; }, onAgentEvent: () => { events++; },
  }, async () => {
    await first.runWithSuppressedModelStream(async () => {
      assert.equal(second.getStreamingContext()?.abortSignal, controller.signal);
      await second.getStreamingContext()?.onStreamChunk?.({ text: "private" });
      await second.emitStreamingEvent(second.getStreamingContext(), { stream: "tool", data: {} });
    });
    await second.getStreamingContext()?.onStreamChunk?.({ text: "visible" });
  });
  assert.equal(chunks, 1);
  assert.equal(events, 1);
});

test("observer failure is reported without rejecting the model flow", async () => {
  let reported: unknown;
  const error = new Error("observer");
  await first.emitStreamingEvent({ onAgentEvent: () => { throw error; },
    reportError: (_scope, cause) => { reported = cause; },
  }, { stream: "tool", data: {} });
  assert.equal(reported, error);
});

test("actual native attempt event consumer falls back to ambient scope once", async () => {
  const { emitAgentHarnessAttemptEvent } = await import("./harness/attempt-events.ts");
  const seen: string[] = [];
  const diagnostics = { label: "fixture", log: { debug: () => undefined } };
  await first.runWithStreamingContext({ onAgentEvent: () => { seen.push("ambient"); } }, async () => {
    await emitAgentHarnessAttemptEvent({ runId: "source-context-fixture" }, { stream: "lifecycle", data: {} }, diagnostics);
    await emitAgentHarnessAttemptEvent({ runId: "source-context-fixture", onAgentEvent: () => { seen.push("explicit"); } },
      { stream: "lifecycle", data: {} }, diagnostics);
  });
  assert.deepEqual(seen, ["ambient", "explicit"]);
});
