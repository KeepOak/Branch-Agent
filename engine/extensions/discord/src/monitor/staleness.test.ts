/**
 * Unit tests for the staleness guard — tag/skip/ignore behavior for
 * out-of-sequence messages. Pure-function assertions.
 */
import type { ReplyPayload as Content } from "branch/plugin-sdk/reply-runtime";
import { describe, expect, it } from "vitest";
import {
  applyDiscordStalenessGuard,
  getDiscordStalenessConfig,
  recordDiscordChannelMessageSeen,
} from "./staleness.js";

function mockMessage(channelId = "channel-1") {
  return {
    id: "message-1",
    channel: { id: channelId },
  } as never;
}

describe("Discord staleness guard", () => {
  it("is disabled by default and parses scoped settings", () => {
    const settings = new Map<string, unknown>([
      ["DISCORD_STALENESS_BEHAVIOR", "skip"],
      ["DISCORD_STALENESS_THRESHOLD", "4"],
    ]);

    expect(getDiscordStalenessConfig((key) => settings.get(key))).toEqual({
      enabled: false,
      behavior: "skip",
      threshold: 4,
    });

    settings.set("DISCORD_STALENESS_ENABLED", "true");
    expect(getDiscordStalenessConfig((key) => settings.get(key))).toEqual({
      enabled: true,
      behavior: "skip",
      threshold: 4,
    });
  });

  it("allows responses when the newer-message delta is within threshold", () => {
    const owner = {};
    const start = recordDiscordChannelMessageSeen(owner, "channel-1", "a");
    recordDiscordChannelMessageSeen(owner, "channel-1", "b");
    const content: Content = { text: "hello" };

    expect(
      applyDiscordStalenessGuard({
        config: { enabled: true, behavior: "skip", threshold: 1 },
        owner,
        message: mockMessage(),
        startSequence: start,
        content,
      }),
    ).toMatchObject({ shouldSend: true, stale: false });
    expect(content.text).toBe("hello");
  });

  it("skips stale responses when configured to skip", () => {
    const owner = {};
    const start = recordDiscordChannelMessageSeen(owner, "channel-1", "a");
    recordDiscordChannelMessageSeen(owner, "channel-1", "b");
    recordDiscordChannelMessageSeen(owner, "channel-1", "c");
    const content: Content = { text: "hello" };

    expect(
      applyDiscordStalenessGuard({
        config: { enabled: true, behavior: "skip", threshold: 1 },
        owner,
        message: mockMessage(),
        startSequence: start,
        content,
      }),
    ).toMatchObject({
      shouldSend: false,
      stale: true,
      messagesSinceTurnStart: 2,
    });
  });

  it("tags stale responses once when configured to tag", () => {
    const owner = {};
    const start = recordDiscordChannelMessageSeen(owner, "channel-1", "a");
    recordDiscordChannelMessageSeen(owner, "channel-1", "b");
    recordDiscordChannelMessageSeen(owner, "channel-1", "c");
    const content: Content = { text: "hello" };

    const first = applyDiscordStalenessGuard({
      config: { enabled: true, behavior: "tag", threshold: 1 },
      owner,
      message: mockMessage(),
      startSequence: start,
      content,
    });
    const second = applyDiscordStalenessGuard({
      config: { enabled: true, behavior: "tag", threshold: 1 },
      owner,
      message: mockMessage(),
      startSequence: start,
      content,
    });

    expect(first).toMatchObject({ shouldSend: true, stale: true });
    expect(second).toMatchObject({ shouldSend: true, stale: true });
    expect(content.text).toBe("(catching up:) hello");
  });
});

describe("staleness config parsing", () => {
  function settings(values: Record<string, string>) {
    return (key: string) => values[key];
  }

  it("ignores a trailing-garbage threshold instead of parsing its prefix", () => {
    // parseInt("4junk") is 4, so a malformed setting silently changed the
    // staleness threshold instead of falling back to the default.
    const config = getDiscordStalenessConfig(settings({ DISCORD_STALENESS_THRESHOLD: "4junk" }));
    expect(config.threshold).toBe(2);
  });

  it("keeps a signed threshold and rejects one past the safe range", () => {
    // `Number.parseInt` accepted "+4"; rejecting it would be a regression.
    expect(
      getDiscordStalenessConfig(settings({ DISCORD_STALENESS_THRESHOLD: "+4" })).threshold,
    ).toBe(4);
    expect(
      getDiscordStalenessConfig(settings({ DISCORD_STALENESS_THRESHOLD: "9007199254740993" }))
        .threshold,
    ).toBe(2);
  });

  it("still honours a clean threshold, including zero", () => {
    expect(
      getDiscordStalenessConfig(settings({ DISCORD_STALENESS_THRESHOLD: "4" })).threshold,
    ).toBe(4);
    expect(
      getDiscordStalenessConfig(settings({ DISCORD_STALENESS_THRESHOLD: "0" })).threshold,
    ).toBe(0);
  });
});

describe("Discord staleness configuration callers", () => {
  it("accepts source threshold boundaries through the real channel schema", async () => {
    const { DiscordConfigSchema } = await import("../config-schema.js");
    for (const threshold of [0, Number.MAX_SAFE_INTEGER]) {
      expect(
        DiscordConfigSchema.safeParse({ staleness: { enabled: true, behavior: "skip", threshold } })
          .success,
      ).toBe(true);
    }
    for (const threshold of [-1, 1.5]) {
      expect(DiscordConfigSchema.safeParse({ staleness: { threshold } }).success).toBe(false);
    }
  });

  it("inherits shared account settings while preserving explicit child overrides", async () => {
    const { mergeDiscordAccountConfig } = await import("../accounts.js");
    const config = mergeDiscordAccountConfig(
      {
        channels: {
          discord: {
            staleness: { enabled: true, behavior: "skip", threshold: 4 },
            accounts: {
              work: { staleness: { threshold: 0 } },
              paused: { staleness: { enabled: false } },
            },
          },
        },
      },
      "work",
    );
    expect(config.staleness).toEqual({ enabled: true, behavior: "skip", threshold: 0 });
  });
});
