// Source scenarios: Hermes tests/agent/test_image_token_cost.py and
// test_compressor_image_tokens.py at18d125cc; extra TS cache/context contracts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageTokenCosts, countImages, currentImageTokenCost, withImageTokenCost, DEFAULT_IMAGE_TOKEN_COST } from "./image-token-cost.ts";
const img = () => ({ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(4000) } }] });
function fixture(run: (costs: ImageTokenCosts, path: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "branch-image-cost-"));
  try { return run(new ImageTokenCosts(join(root, "costs.json")), join(root, "costs.json")); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const history = () => [{ role: "user", content: "start" }, { role: "assistant", content: "ok" }, img(), { role: "assistant", content: "looking" }, img()];
function calibrate(costs: ImageTokenCosts, price: unknown, messages = history(), anchor: { baseCount: number } | null = { baseCount: 2 }, estimate = () => {
  assert.equal(currentImageTokenCost(), 0); return 10020;
}) {
  return costs.calibrate({ model: "vision-local", baseUrl: "http://127.0.0.1:8080/v1", messages, anchor, promptTokens: price, anchoredContextTokens: estimate });
}
test("source residual teaches 4000 per screenshot and persists per model/host", () => fixture((costs, path) => {
  withImageTokenCost(null, () => {
    assert.equal(calibrate(costs, 18020), 4000);
    assert.equal(currentImageTokenCost(), 4000);
    assert.ok(countImages([img()]) * currentImageTokenCost() >= 4000);
  });
  assert.equal(new ImageTokenCosts(path).learned("vision-local", "127.0.0.1:8080/v1"), 4000);
  assert.equal(costs.learned("other-model", "http://127.0.0.1:8080/v1"), DEFAULT_IMAGE_TOKEN_COST);
}));
test("source text-only, missing anchor and implausible residual teach nothing", () => fixture((costs) => {
  assert.equal(calibrate(costs, 50000, history().slice(0, 2).concat([{ role: "user", content: "no image here" }])), null);
  assert.equal(calibrate(costs, 50000, history(), null), null);
  assert.equal(calibrate(costs, 10001), null);
  assert.equal(costs.learned("vision-local", "127.0.0.1"), 1500);
}));
test("EMA preserves upstream truncation", () => fixture((costs) => {
  assert.equal(calibrate(costs, 18020), 4000);
  assert.equal(calibrate(costs, 14022), 3000);
}));
test("stale anchor estimator vetoes calibration", () => fixture((costs) => {
  assert.equal(costs.calibrate({ messages: history(), anchor: { baseCount: 2 }, promptTokens: 18020, anchoredContextTokens: () => null }), null);
}));
test("already-priced assistant image is skipped", () => fixture((costs) => {
  const messages = [{ role: "user", content: "start" }, { ...img(), role: "assistant" }, img()];
  assert.equal(calibrate(costs, 14020, messages, { baseCount: 1 }), 4000);
}));
test("all upstream image part containers are counted", () => {
  assert.equal(countImages([{ content: [{ type: "image" }, { type: "input_image" }, { type: "text" }], _anthropic_content_blocks: [{ type: "image" }], output: [{ type: "image_url" }] }, { content: { _multimodal: true, content: [{ type: "image" }, { type: "image_url" }] } }]), 6);
});
test("cache ignores malformed and out-of-band values", () => fixture((_costs, path) => {
  writeFileSync(path, JSON.stringify({ "x@host": 64, "bad@host": 63, "bool@host": true, "high@host": 32769, "frac@host": 70.5 }));
  const costs = new ImageTokenCosts(path);
  assert.equal(costs.learned("x", "host"), 64);
  for (const model of ["bad", "bool", "high", "frac"]) { assert.equal(costs.learned(model, "host"), 1500); }
}));
test("invalid JSON cache falls back", () => fixture((_costs, path) => {
  writeFileSync(path, "{"); assert.equal(new ImageTokenCosts(path).learned("x", "host"), 1500);
}));
test("profiles never share tables", () => fixture((first, path) => {
  calibrate(first, 18020);
  assert.equal(new ImageTokenCosts(path + ".profile2").learned("vision-local", "127.0.0.1"), 1500);
}));
test("host normalized independent of path/port, other host remains independent", () => fixture((costs) => {
  calibrate(costs, 18020);
  assert.equal(costs.learned("vision-local", "http://127.0.0.1:9999/other"), 4000);
  assert.equal(costs.learned("vision-local", "http://other.test/v1"), 1500);
}));
test("context restores on throw and nested zero is retained", () => {
  assert.equal(currentImageTokenCost(), 1500);
  withImageTokenCost(4000, () => {
    assert.throws(() => withImageTokenCost(0, () => { assert.equal(currentImageTokenCost(), 0); throw new Error("fixture"); }));
    assert.equal(currentImageTokenCost(), 4000);
  });
  assert.equal(currentImageTokenCost(), 1500);
});
test("async turns do not leak learned costs across branches", async () => {
  const observed = await Promise.all([4000, 2000].map((cost) => withImageTokenCost(cost, async () => { await Promise.resolve(); return currentImageTokenCost(); })));
  assert.deepEqual(observed, [4000, 2000]); assert.equal(currentImageTokenCost(), 1500);
});
test("persistence failure does not discard learned observation", () => fixture((_costs, path) => {
  mkdirSync(path); const costs = new ImageTokenCosts(path);
  assert.equal(calibrate(costs, 18020), 4000);
  assert.equal(costs.learned("vision-local", "127.0.0.1"), 4000);
}));
test("nonnumeric usage and invalid transcript position never calibrate", () => fixture((costs) => {
  for (const usage of ["invalid", Infinity, {}, null, -1]) { assert.equal(calibrate(costs, usage), null); }
  for (const baseCount of [0, -1, 99, 1.5]) { assert.equal(calibrate(costs, 18020, history(), { baseCount }), null); }
}));
test("plausible bounds inclusive and high residual rejected", () => fixture((costs) => {
  assert.equal(calibrate(costs, 10148), 64);
  assert.equal(calibrate(costs, 75558), null);
}));
