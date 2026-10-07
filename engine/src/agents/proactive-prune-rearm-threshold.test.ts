// From NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_proactive_prune_rearm_threshold.py (atlas AGENT-LOOP-0102). Five source cases ported with Branch estimates and warning callback.
import { expect, it, vi } from "vitest";
import { estimateMessagesTokens } from "./compaction-planning.js";
import { ProactiveToolResultPruner } from "./proactive-tool-result-pruning.js";
import { buildHistory } from "./proactive-tool-result-pruning.test-support.js";
const configured = (min = 4096, warn = vi.fn()) =>
  new ProactiveToolResultPruner(
    {
      proactivePruneTokens: 48_000,
      proactivePruneMinResultChars: 8000,
      proactivePruneMinReclaimTokens: min,
      thresholdTokens: 500_000,
    },
    warn,
  );
it("test_billed_basis_over_threshold_defeats_message_only_rearm_lockout", async () => {
  const c = configured(),
    messages = buildHistory();
  c.rearmTokens = estimateMessagesTokens(messages) + 913;
  expect(estimateMessagesTokens(messages)).toBeLessThan(c.rearmTokens);
  const scan = vi.spyOn(c, "scan");
  const r = await c.pruneToolResultsOnly(messages, c.thresholdTokens + 1);
  expect(scan).toHaveBeenCalledOnce();
  expect(r.pruned).toBe(3);
  expect(r.messages).not.toBe(messages);
});
it("test_message_only_rearm_still_holds_below_threshold", async () => {
  const c = configured(),
    messages = buildHistory();
  c.rearmTokens = estimateMessagesTokens(messages) + 913;
  const scan = vi.spyOn(c, "scan");
  const r = await c.pruneToolResultsOnly(messages, c.thresholdTokens - 1);
  expect(c.thresholdTokens - 1).toBeGreaterThanOrEqual(c.proactivePruneTokens);
  expect(scan).not.toHaveBeenCalled();
  expect(r.messages).toBe(messages);
  expect(r.pruned).toBe(0);
});
it("test_no_op_below_the_prune_trigger", async () => {
  const c = configured(),
    messages = buildHistory();
  c.onSessionReset();
  const scan = vi.spyOn(c, "scan");
  const r = await c.pruneToolResultsOnly(messages, c.proactivePruneTokens - 1);
  expect(scan).not.toHaveBeenCalled();
  expect(r.messages).toBe(messages);
  expect(r.pruned).toBe(0);
});
it("test_over_threshold_reclamation_no_op_warns_once", async () => {
  const warn = vi.fn(),
    c = configured(10_000_000, warn),
    messages = buildHistory(),
    billed = c.thresholdTokens + 5000;
  const r = await c.pruneToolResultsOnly(messages, billed);
  expect(r).toEqual({ messages, pruned: 0 });
  expect(warn).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("over the compression threshold"));
  await c.pruneToolResultsOnly(messages, billed);
  expect(warn).toHaveBeenCalledOnce();
});
it("test_under_threshold_no_op_is_not_warned", async () => {
  const warn = vi.fn(),
    c = configured(10_000_000, warn),
    messages = buildHistory();
  expect(await c.pruneToolResultsOnly(messages, c.thresholdTokens - 1)).toEqual({
    messages,
    pruned: 0,
  });
  expect(warn).not.toHaveBeenCalled();
});
