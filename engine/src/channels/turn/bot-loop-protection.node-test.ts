import assert from "node:assert/strict";
import { test } from "node:test";
import { recordChannelBotPairLoopAndCheckSuppression } from "./bot-loop-protection.js";

function facts(scopeId: string) {
  return {
    scopeId,
    conversationId: "room",
    senderId: "bot-a",
    receiverId: "bot-b",
    defaultEnabled: true,
    nowMs: 1000,
  };
}

test("inherited production channel guard permits twenty events then suppresses both directions", () => {
  const base = facts("native-default");
  for (let n = 0; n < 20; n++) {
    assert.equal(
      recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: String(n) }).suppressed,
      false,
    );
  }
  assert.deepEqual(recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: "20" }), {
    suppressed: true,
    cooldownUntilMs: 61000,
  });
  assert.equal(
    recordChannelBotPairLoopAndCheckSuppression({
      ...base,
      senderId: "bot-b",
      receiverId: "bot-a",
      eventId: "21",
    }).suppressed,
    true,
  );
});

test("inherited loop guard keeps rooms/accounts independent and supports opt-out", () => {
  const base = { ...facts("native-isolation"), config: { maxEventsPerWindow: 1 } };
  recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: "1" });
  assert.equal(
    recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: "2" }).suppressed,
    true,
  );
  for (const override of [
    { scopeId: "other" },
    { conversationId: "other" },
    { config: { enabled: false } },
    { defaultEnabled: false },
  ]) {
    assert.equal(
      recordChannelBotPairLoopAndCheckSuppression({ ...base, ...override }).suppressed,
      false,
    );
  }
});

test("inherited loop guard deduplicates retries and expires cooldown", () => {
  const base = { ...facts("native-retry"), config: { maxEventsPerWindow: 1, cooldownSeconds: 1 } };
  recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: "1" });
  assert.equal(
    recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: "1" }).suppressed,
    false,
  );
  assert.equal(
    recordChannelBotPairLoopAndCheckSuppression({ ...base, eventId: "2" }).suppressed,
    true,
  );
  assert.equal(
    recordChannelBotPairLoopAndCheckSuppression({ ...base, nowMs: 2000, eventId: "3" }).suppressed,
    false,
  );
});
