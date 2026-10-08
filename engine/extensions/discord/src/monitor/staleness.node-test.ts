import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDiscordStalenessGuard,
  getDiscordStalenessConfig,
  recordDiscordChannelMessageSeen,
} from "./staleness.js";

test("source defaults keep staleness disabled with tag threshold two", () => {
  assert.deepEqual(
    getDiscordStalenessConfig(() => undefined),
    {
      enabled: false,
      behavior: "tag",
      threshold: 2,
    },
  );
});

test("source parser rejects malformed and unsafe thresholds, accepting zero", () => {
  for (const value of ["4junk", "9007199254740993", -1]) {
    assert.equal(getDiscordStalenessConfig(() => value).threshold, 2);
  }
  assert.equal(getDiscordStalenessConfig(() => "+4").threshold, 4);
  assert.equal(getDiscordStalenessConfig(() => 0).threshold, 0);
});

for (const behavior of ["tag", "skip", "ignore"] as const) {
  test(`source ${behavior} behavior across receipt and newer ingress`, () => {
    const owner = {};
    const startSequence = recordDiscordChannelMessageSeen(owner, "room", "first");
    recordDiscordChannelMessageSeen(owner, "room", "second");
    recordDiscordChannelMessageSeen(owner, "room", "third");
    const content = { text: "answer" };
    const result = applyDiscordStalenessGuard({
      config: { enabled: true, behavior, threshold: 1 },
      owner,
      message: { channel_id: "room" },
      startSequence,
      content,
    });
    assert.equal(result.shouldSend, behavior !== "skip");
    assert.equal(result.stale, behavior !== "ignore");
    assert.equal(content.text, behavior === "tag" ? "(catching up:) answer" : "answer");
    applyDiscordStalenessGuard({
      config: { enabled: true, behavior, threshold: 1 },
      owner,
      message: { channel_id: "room" },
      startSequence,
      content,
    });
    assert.equal(content.text, behavior === "tag" ? "(catching up:) answer" : "answer");
  });
}

test("other accounts and rooms cannot supersede a reply", () => {
  const owner = {};
  const startSequence = recordDiscordChannelMessageSeen(owner, "room", "first");
  for (let n = 0; n < 5; n++) {
    recordDiscordChannelMessageSeen(owner, "other-room");
    recordDiscordChannelMessageSeen({}, "room");
  }
  assert.equal(
    applyDiscordStalenessGuard({
      config: { enabled: true, behavior: "skip", threshold: 0 },
      owner,
      message: { channel_id: "room" },
      startSequence,
      content: { text: "answer" },
    }).shouldSend,
    true,
  );
});

test("newest debounced message is not superseded by older members of its batch", () => {
  const owner = {};
  recordDiscordChannelMessageSeen(owner, "room", "first");
  const startSequence = recordDiscordChannelMessageSeen(owner, "room", "second");
  assert.equal(
    applyDiscordStalenessGuard({
      config: { enabled: true, behavior: "skip", threshold: 0 },
      owner,
      message: { channel_id: "room" },
      startSequence,
      content: {},
    }).stale,
    false,
  );
});
