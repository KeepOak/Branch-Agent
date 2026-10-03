import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureUsageAnchor, anchoredContextTokens, messageFingerprint } from "./image-usage-anchor.ts";
import { ImageTokenCosts, countImages, currentImageTokenCost, withImageTokenCost } from "./image-token-cost.ts";
import type { ImageCostMessage } from "./image-token-cost.ts";
const msg = (role: string, content: unknown): ImageCostMessage => ({ role, content });
const img = () => msg("user", [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(40000) } }]);
const history = () => [msg("user", "start"), msg("assistant", "hello"), msg("user", "do the thing"), msg("assistant", "done")];
// An explicit controlled estimator, not Branch's full production tokenizer.
const estimate = (messages: readonly ImageCostMessage[]) => countImages(messages) * currentImageTokenCost() + messages.length * 5;
test("source anchor plus small delta skips completion reply", () => {
  const messages = history(); const anchor = captureUsageAnchor(50000, 250, messages);
  assert.ok(anchor); assert.equal(anchor.promptTokens, 50000); assert.equal(anchor.baseCount, messages.length);
  messages.push(msg("assistant", "the anchored reply itself"), msg("user", "short follow-up"));
  const delta = estimate([messages.at(-1)!]);
  assert.equal(anchoredContextTokens(messages, anchor, estimate), 50000 + 250 + delta);
  assert.ok(delta < 50);
});
test("source provider anchor avoids whole-history image heuristic divergence", () => {
  const messages = [msg("user", "start"), ...Array.from({ length: 10 }, img)];
  const anchor = captureUsageAnchor(12000, 100, messages);
  messages.push(msg("assistant", "reply"), msg("user", "ok"));
  const rough = estimate(messages); const anchored = anchoredContextTokens(messages, anchor, estimate);
  assert.ok(rough >= 15000); assert.ok(anchored !== null && anchored < 12200); assert.ok(rough - anchored > 2800);
});
test("source missing usage and missing anchor return null", () => {
  for (const usage of [0, null, "garbage"]) { assert.equal(captureUsageAnchor(usage, 1, history()), null); }
  assert.equal(anchoredContextTokens(history(), null, estimate), null);
});
test("source compaction and middle splice fail closed", () => {
  const messages = history(); const anchor = captureUsageAnchor(30000, 50, messages);
  assert.equal(anchoredContextTokens([msg("user", "summary"), msg("assistant", "compressed")], anchor, estimate), null);
  assert.equal(anchoredContextTokens([messages[0]!, msg("assistant", "marker"), messages[3]!], anchor, estimate), null);
});
test("source prefix rewrite preserving base row fails closed", () => {
  const messages = history(); const anchor = captureUsageAnchor(30000, 50, messages);
  const rewritten = [msg("user", "summary"), msg("assistant", "compressed"), msg("user", "new"), { ...messages[3]! }, msg("user", "post-anchor")];
  assert.equal(anchoredContextTokens(rewritten, anchor, estimate), null);
});
test("source transcript reload ignores persistence metadata but rejects content edits", () => {
  const messages = history(); const anchor = captureUsageAnchor(30000, 50, messages);
  const reloaded: ImageCostMessage[] = messages.map((message, index) => ({ ...message, timestamp: 1, _row_id: index }));
  assert.equal(anchoredContextTokens(reloaded, anchor, estimate), 30050);
  reloaded[3] = { ...reloaded[3]!, content: "different" };
  assert.equal(anchoredContextTokens(reloaded, anchor, estimate), null);
});
test("canonical nested object ordering preserves provider identity", () => {
  assert.equal(messageFingerprint(msg("user", [{ b: 1, a: 2 }])), messageFingerprint(msg("user", [{ a: 2, b: 1 }])));
  assert.notEqual(messageFingerprint({ ...msg("tool", "x"), tool_call_id: "one" }), messageFingerprint({ ...msg("tool", "x"), tool_call_id: "two" }));
});
test("JSON anchor round trip survives fresh objects without live database writes", () => {
  const messages = history(); const anchor = captureUsageAnchor(10000, 20, messages);
  assert.equal(anchoredContextTokens(JSON.parse(JSON.stringify(messages)), JSON.parse(JSON.stringify(anchor)), estimate), 10020);
});
test("unusable/cyclic data and nonfinite estimator cannot suppress context pressure", () => {
  const messages = history(); messages[0]!.content = messages[0];
  assert.equal(captureUsageAnchor(10000, 20, messages), null);
  const good = history(); const anchor = captureUsageAnchor(10000, 20, good); good.push(msg("user", "tail"));
  assert.equal(anchoredContextTokens(good, anchor, () => Infinity), null);
});
test("real captured anchor calibrates image costs, rejects rewrite, and restores turn cost", () => {
  const root = mkdtempSync(join(tmpdir(), "branch-anchor-"));
  try {
    const costs = new ImageTokenCosts(join(root, "costs.json")); const messages = history();
    const anchor = captureUsageAnchor(10000, 5, messages); assert.ok(anchor);
    messages.push(msg("assistant", "reply"), img(), msg("assistant", "looking"), img());
    costs.withModelCost("vision", "host", () => {
      const textOnly = withImageTokenCost(0, () => anchoredContextTokens(messages, anchor, estimate)); assert.ok(textOnly !== null);
      assert.equal(costs.calibrate({ model: "vision", baseUrl: "host", anchor, messages, promptTokens: textOnly + 8000,
        anchoredContextTokens: (wire) => anchoredContextTokens(wire, anchor, estimate) }), 4000);
      assert.equal(currentImageTokenCost(), 4000);
      messages[0] = msg("user", "rewritten prefix");
      assert.equal(costs.calibrate({ model: "vision", baseUrl: "host", anchor, messages, promptTokens: textOnly + 12000,
        anchoredContextTokens: (wire) => anchoredContextTokens(wire, anchor, estimate) }), null);
      assert.equal(costs.learned("vision", "host"), 4000);
    });
    assert.equal(currentImageTokenCost(), 1500);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
