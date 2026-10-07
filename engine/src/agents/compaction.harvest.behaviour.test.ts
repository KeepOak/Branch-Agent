// Written by Branch for atlas AGENT-LOOP-0099 owner rule R-1541: folded history includes both ends and recent owner turns remain verbatim.
import { expect, it } from "vitest";
import {
  DEFAULT_COMPACTION_SETTINGS,
  generateSummary,
  prepareCompaction,
} from "../../packages/agent-core/src/harness/compaction/compaction.js";
import {
  createCompactionModel,
  createMessageEntry,
} from "../../packages/agent-core/src/harness/compaction/compaction.test-support.js";
import { createZeroUsage } from "../../packages/ai/src/usage.test-support.js";
import type { AgentMessage } from "./runtime/index.js";
it("automatic compaction ships enabled", () => {
  expect(DEFAULT_COMPACTION_SETTINGS.enabled).toBe(true);
});
it("sends both ends of a folded range longer than 60000 characters to the summarizer", async () => {
  const model = createCompactionModel({ contextWindow: 128000 });
  let prompt = "";
  const messages: AgentMessage[] = [
    { role: "user", content: "FOLDED-START " + "a".repeat(70000), timestamp: 1 },
    { role: "user", content: "FOLDED-END must remain in the checkpoint", timestamp: 2 },
  ];
  const result = await generateSummary(
    messages,
    model,
    1000,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      completeSimple: async (_model, context) => {
        prompt = JSON.stringify(context);
        return {
          role: "assistant",
          content: [{ type: "text", text: "both ends summarized" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: createZeroUsage(),
          stopReason: "stop",
          timestamp: 3,
        };
      },
    },
  );
  expect(result.ok).toBe(true);
  expect(prompt).toContain("FOLDED-START");
  expect(prompt).toContain("FOLDED-END must remain in the checkpoint");
  expect(messages[0].content).toHaveLength(70013);
});
it("keeps the owner's latest long message unchanged at the retained boundary", () => {
  const latest = {
    role: "user" as const,
    content: "RECENT-START\n" + "verbatim constraint\n".repeat(300) + "RECENT-END",
    timestamp: 4,
  };
  const entries = [
    createMessageEntry(
      { role: "user", content: "old request " + "x".repeat(25000), timestamp: 1 },
      0,
    ),
    createMessageEntry(
      { role: "user", content: "old followup " + "x".repeat(25000), timestamp: 2 },
      1,
    ),
    createMessageEntry(latest, 2),
  ];
  const prepared = prepareCompaction(entries, {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 2000,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok || !prepared.value) throw Error("not compactable");
  const index = entries.findIndex((entry) => entry.id === prepared.value.firstKeptEntryId);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(
    entries.slice(index).some((entry) => entry.type === "message" && entry.message === latest),
  ).toBe(true);
  expect(latest.content).toBe(
    "RECENT-START\n" + "verbatim constraint\n".repeat(300) + "RECENT-END",
  );
});
