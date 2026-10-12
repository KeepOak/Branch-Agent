// From NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_proactive_prune_config.py (atlas AGENT-LOOP-0102). Ported config normalization cases; fractional and integral string checks added.
import { expect, it } from "vitest";
import { ProactiveToolResultPruner, pruneInteger } from "./proactive-tool-result-pruning.js";
it("test_custom_values_are_honored", () => {
  const c = new ProactiveToolResultPruner({
    proactivePruneTokens: 48_000,
    proactivePruneMinResultChars: 12_000,
    proactivePruneMinReclaimTokens: 8192,
  });
  expect(c.proactivePruneTokens).toBe(48_000);
  expect(c.proactivePruneMinResultChars).toBe(12_000);
  expect(c.proactivePruneMinReclaimTokens).toBe(8192);
});
it("test_boolean_is_rejected_not_coerced", () => {
  expect(new ProactiveToolResultPruner({ proactivePruneTokens: true }).proactivePruneTokens).toBe(
    0,
  );
});
it("rejects fractional values and accepts integral numeric strings", () => {
  expect(pruneInteger(4.5, 0)).toBe(0);
  expect(pruneInteger("48000", 0)).toBe(48000);
  expect(pruneInteger(48000.0, 0)).toBe(48000);
});
