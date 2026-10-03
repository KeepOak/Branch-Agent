import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScriptPayloadResult, parseTriggerResult } from "./trigger-script-result.js";

function completed(value: unknown, output: unknown[] = []) {
  return { status: "completed" as const, value, output, toolCallCount: 0 };
}

test("trigger decision survives trailing structured diagnostic logs", () => {
  assert.deepEqual(parseTriggerResult(completed(undefined, [
    { type: "json", value: { fire: false, state: { cursor: 3 } } },
    { type: "json", value: { inspected: 3 } },
    { type: "json", value: null },
  ])), { kind: "evaluated", fire: false, state: { cursor: 3 } });
});

test("explicit malformed decisions cannot fall back to an earlier success", () => {
  for (const fire of [undefined, null, "false", 1]) {
    const result = parseTriggerResult(completed({ fire }, [
      { type: "json", value: { fire: true } },
    ]));
    assert.equal(result.kind, "error");
  }
  assert.equal(parseTriggerResult(completed(undefined, [
    { type: "json", value: { fire: true } },
    { type: "json", value: { fire: "false" } },
  ])).kind, "error");
});

test("returned decision takes precedence and state is detached", () => {
  const state = { cursor: 4 };
  const result = parseTriggerResult(completed({ fire: true, message: "changed", state }, [
    { type: "json", value: { fire: false } },
  ]));
  state.cursor = 9;
  assert.deepEqual(result, { kind: "evaluated", fire: true, message: "changed", state: { cursor: 4 } });
});

test("upstream state serialization and byte limit remain intact", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const state of [undefined, 1n, circular, "é".repeat(8192)]) {
    assert.equal(parseTriggerResult(completed({ fire: false, state })).kind, "error");
  }
  assert.deepEqual(parseTriggerResult(completed({ fire: false, state: null })), {
    kind: "evaluated", fire: false, state: null,
  });
});

test("script payload notification, wake, cadence and state keep source contract", () => {
  assert.deepEqual(parseScriptPayloadResult(completed({ notify: "ready", wake: "next-heartbeat", nextCheck: "1h30m", state: { cursor: 5 } })), {
    kind: "completed", notify: "ready", wake: "next-heartbeat", nextCheck: { delayMs: 5400000 }, stateChanged: true, state: { cursor: 5 },
  });
  for (const value of [{ notify: 1 }, { wake: "later" }, { nextCheck: "0s" }, { nextCheck: "oops" }]) {
    assert.equal(parseScriptPayloadResult(completed(value)).kind, "error");
  }
  assert.deepEqual(parseScriptPayloadResult(completed(undefined, [{ type: "json", value: {} }])), { kind: "completed", stateChanged: false });
});
