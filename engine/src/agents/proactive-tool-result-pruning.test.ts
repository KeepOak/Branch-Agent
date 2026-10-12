// From NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_proactive_tool_result_pruning.py (atlas AGENT-LOOP-0102). Six source cases ported to canonical Branch messages; persistence and owner-tail assertions added.
import { expect, it, vi } from "vitest";
import { estimateMessagesTokens } from "./compaction-planning.js";
import {
  ProactiveToolResultPruner,
  PRUNED_TOOL_PLACEHOLDER,
  pruneBeforeSummarizing,
} from "./proactive-tool-result-pruning.js";
import {
  assistantCall,
  toolMessage,
  buildHistory,
  toolText,
} from "./proactive-tool-result-pruning.test-support.js";
import type { AgentMessage } from "./runtime/index.js";
const configured = () =>
  new ProactiveToolResultPruner({
    proactivePruneTokens: 48_000,
    proactivePruneMinResultChars: 8000,
    thresholdTokens: 500_000,
  });
it("test_prunes_below_compression_threshold", async () => {
  const c = configured(),
    messages = buildHistory();
  expect(120_000).toBeLessThan(c.thresholdTokens);
  const r = await c.pruneToolResultsOnly(messages, 120_000);
  expect(r.pruned).toBeGreaterThanOrEqual(3);
  expect(r.messages).toHaveLength(messages.length);
  for (const id of ["call_0", "call_1", "call_2"]) {
    expect(toolText(r.messages, id).length).toBeLessThan(9000);
    expect(toolText(r.messages, id)).not.toBe(PRUNED_TOOL_PLACEHOLDER);
  }
});
it("test_idempotent", async () => {
  const c = configured();
  const first = await c.pruneToolResultsOnly(buildHistory(), 120_000);
  expect(first.pruned).toBeGreaterThanOrEqual(3);
  const second = await c.pruneToolResultsOnly(first.messages);
  expect(second.pruned).toBe(0);
  expect(second.messages).toEqual(first.messages);
});
it("test_rearms_only_after_reclaimed_token_runway", async () => {
  const c = configured();
  const first = await c.pruneToolResultsOnly(buildHistory(8, [0, 1, 2, 6, 7]), 120_000);
  expect(first.pruned).toBeGreaterThanOrEqual(3);
  const rearm = estimateMessagesTokens(first.messages) + 48_000;
  const grown = [
    ...first.messages,
    assistantCall("call_8"),
    toolMessage("call_8", "ok"),
    assistantCall("call_9"),
    toolMessage("call_9", "ok"),
  ];
  expect(estimateMessagesTokens(grown)).toBeLessThan(rearm);
  const blocked = await c.pruneToolResultsOnly(grown, c.thresholdTokens - 1);
  expect(blocked.pruned).toBe(0);
  expect(blocked.messages).toBe(grown);
  expect(toolText(blocked.messages, "call_6")).toHaveLength(9000);
  expect(toolText(blocked.messages, "call_7")).toHaveLength(9000);
  const missing = rearm - estimateMessagesTokens(grown);
  const regrown: AgentMessage[] = [
    ...grown,
    { role: "user", content: "x".repeat(missing * 4), timestamp: 2 },
  ];
  expect(estimateMessagesTokens(regrown)).toBeGreaterThanOrEqual(rearm);
  const rearmed = await c.pruneToolResultsOnly(regrown, c.thresholdTokens - 1);
  expect(rearmed.pruned).toBeGreaterThanOrEqual(2);
  expect(rearmed.messages).not.toBe(regrown);
});
it("resets the runway on the full-compression callback; source lifecycle integration remains pending", async () => {
  const c = configured();
  expect((await c.pruneToolResultsOnly(buildHistory(), 120_000)).pruned).toBeGreaterThanOrEqual(3);
  c.onFullCompression();
  const fresh = buildHistory();
  const r = await c.pruneToolResultsOnly(fresh, 48_000);
  expect(r.pruned).toBeGreaterThanOrEqual(3);
  expect(r.messages).not.toBe(fresh);
});
it("test_min_reclaim_gate_clamp", () => {
  for (const value of [0, -5, null])
    expect(
      new ProactiveToolResultPruner({ proactivePruneMinReclaimTokens: value })
        .proactivePruneMinReclaimTokens,
    ).toBe(0);
});
it("test_no_orphans_both_directions", async () => {
  const r = await new ProactiveToolResultPruner({
    proactivePruneTokens: 48_000,
    proactivePruneMinReclaimTokens: 0,
  }).pruneToolResultsOnly(buildHistory(10, [0, 1, 2, 3, 4]), 120_000);
  expect(r.pruned).toBeGreaterThanOrEqual(1);
  const calls = r.messages.flatMap((m) =>
    m.role === "assistant" ? m.content.flatMap((p) => (p.type === "toolCall" ? [p.id] : [])) : [],
  );
  const results = r.messages.flatMap((m) => (m.role === "toolResult" ? [m.toolCallId] : []));
  expect(new Set(calls)).toEqual(new Set(results));
});
it("test_unset_config_zero_behavior_change", async () => {
  const c = new ProactiveToolResultPruner(),
    messages = buildHistory(),
    snapshot = structuredClone(messages);
  expect(c.proactivePruneTokens).toBe(0);
  const r = await c.pruneToolResultsOnly(messages, 10_000_000);
  expect(r.pruned).toBe(0);
  expect(r.messages).toBe(messages);
  expect(messages).toEqual(snapshot);
});
it("keeps original history and rearm state when persistence fails", async () => {
  const c = configured(),
    messages = buildHistory();
  const persist = vi.fn().mockRejectedValue(Error("stale generation"));
  const r = await c.pruneToolResultsOnly(messages, 120_000, persist);
  expect(r.messages).toBe(messages);
  expect(r.pruned).toBe(0);
  expect(c.rearmTokens).toBe(0);
  expect(persist).toHaveBeenCalledOnce();
});
it("preserves the newest 40k tokens and canonical arguments before summarization", async () => {
  const messages = buildHistory(8, [0, 1, 6, 7], 120_000),
    snapshot = structuredClone(messages);
  const result = await pruneBeforeSummarizing(messages);
  expect(toolText(result, "call_0").length).toBeLessThan(120_000);
  expect(toolText(result, "call_6")).toHaveLength(120_000);
  expect(toolText(result, "call_7")).toHaveLength(120_000);
  expect(messages).toEqual(snapshot);
  for (let i = 0; i < messages.length; i++)
    if (messages[i].role === "assistant") expect(result[i]).toBe(messages[i]);
});
