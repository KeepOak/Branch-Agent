// Arithmetic vectors copied from Hermes tests/agent/test_image_eviction_policy.py.
import assert from "node:assert/strict";
import { test } from "node:test";
import { outboundImageRetireCount as retire, OUTBOUND_IMAGE_LIMIT as LIMIT, IMAGE_EVICTION_BATCH as BATCH, OUTBOUND_IMAGE_FLOOR as FLOOR } from "./image-eviction-policy.ts";
import { retireOutboundToolImages } from "./outbound-tool-image-retirement.ts";
const MB = 1000000;
const vectors: [number[], number, number[] | undefined, number, number][] = [
  [Array(LIMIT).fill(1), 0, undefined, 0, 0],
  [Array(LIMIT + 1).fill(1), 0, undefined, 0, BATCH],
  [Array(LIMIT + BATCH).fill(1), 0, undefined, 0, BATCH],
  [Array(LIMIT + BATCH + 1).fill(1), 0, undefined, 0, 2 * BATCH],
  [[LIMIT + 5], 0, undefined, 0, 1],
  [[10, 10, 10, 10], 0, undefined, 0, 2],
  [Array(5).fill(1), LIMIT + 1, undefined, 0, 5 - FLOOR],
  [[1, 1], LIMIT + 5, undefined, 0, 0],
  [[1, 1, 1], 5, Array(3).fill(3 * MB), 25 * MB, 3],
  [Array(13).fill(1), 0, Array(13).fill(2 * MB), 0, BATCH],
  [[], 0, undefined, 0, 0],
];
for (const [index, [blocks, reserved, sizes, reservedBytes, expected]] of vectors.entries()) {
  test(`source arithmetic vector ${index}`, () => assert.equal(retire(blocks, reserved, { carrierBytesNewestFirst: sizes, reservedBytes }), expected));
}
test("source heavy-carrier quantum remains step function", () => {
  const window = Math.floor(LIMIT / 3); const counts = Array.from({ length: 9 }, (_, index) => retire(Array(window + 1 + index).fill(3), 0));
  assert.ok(counts.every((count) => count > 0));
  assert.ok(counts.every((count, index) => 3 * (window + 1 + index - count) <= LIMIT));
  const moves = counts.slice(1).filter((count, index) => count !== counts[index]).length;
  assert.ok(moves <= Math.floor(counts.length / (window - FLOOR)));
});
type Message = Record<string, unknown>;
const image = (blob = "AAAA") => ({ type: "image_url", image_url: { url: `data:image/png;base64,${blob}` } });
function history(count: number): Message[] {
  return [{ role: "user", content: "look" }, ...Array.from({ length: count }, (_, index) => ({ role: "tool", tool_call_id: `call_${index}`, api_content: "stale-image", content: [{ type: "text", text: `shot${index}` }, image()] })), { role: "user", content: "compare" }];
}
const keptIds = (messages: Message[]) => messages.filter((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url")).map((message) => message.tool_call_id);
test("source below limit preserves every message and prefix identity", () => {
  const input = history(LIMIT); const projected = retireOutboundToolImages(input);
  assert.equal(projected.retired, 0); assert.deepEqual(keptIds(projected.messages), Array.from({ length: LIMIT }, (_, index) => `call_${index}`));
  assert.ok(projected.messages.every((message, index) => message === input[index]));
});
test("source above limit strips oldest batch and stale sidecar, never persisted history", () => {
  const input = history(LIMIT + 1); const before = JSON.stringify(input); const projected = retireOutboundToolImages(input);
  assert.equal(projected.retired, BATCH);
  assert.deepEqual(keptIds(projected.messages), Array.from({ length: LIMIT + 1 - BATCH }, (_, index) => `call_${index + BATCH}`));
  assert.ok(JSON.stringify(projected.messages[1]!.content).includes("screenshot removed"));
  assert.equal(Object.hasOwn(projected.messages[1]!, "api_content"), false);
  assert.equal(JSON.stringify(input), before);
});
test("source frontier holds across three windows while ceiling enforced", () => {
  const kept = Array.from({ length: LIMIT + 3 * BATCH - FLOOR - 1 }, (_, index) => keptIds(retireOutboundToolImages(history(FLOOR + 1 + index)).messages));
  assert.ok(kept.every((ids) => ids.length <= LIMIT));
  const frontier = kept.map((ids) => ids[0]);
  assert.equal(frontier.slice(1).filter((id, index) => id !== frontier[index]).length, 3);
});
test("user upload blocks reserved and never rewritten", () => {
  const input = history(LIMIT); const user = { role: "user", content: [image()] }; input.unshift(user);
  const projected = retireOutboundToolImages(input); assert.equal(projected.retired, BATCH); assert.equal(projected.messages[0], user);
});
test("native multimodal source envelope collapses to bounded summary", () => {
  const input = history(LIMIT); input.unshift({ role: "tool", tool_call_id: "native", api_content: "stale", content: { _multimodal: true, text_summary: "summary".repeat(50), content: [image()] } });
  const projected = retireOutboundToolImages(input);
  assert.equal(projected.retired, BATCH); assert.equal(projected.messages[0]!.content, `[screenshot removed] ${"summary".repeat(50).slice(0, 200)}`);
  assert.equal(Object.hasOwn(projected.messages[0]!, "api_content"), false);
});
