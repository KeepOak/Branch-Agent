// From lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da:packages/context-engine/src/providers/__tests__/DiscordContextProvider.test.ts (atlas AGENT-LOOP-0164). Adapted to Branch's inbound system prompt.
import { describe, expect, it } from "vitest";
import {
  appendDiscordContext,
  formatDiscordBotPlatformContext,
  formatDiscordContext,
} from "./discord-context-provider.js";

describe("DiscordContextProvider", () => {
  it("should inject discord context before first user message", () => {
    expect(
      appendDiscordContext("You are a helpful assistant.", {
        guild: { id: "123456" },
        channel: { id: "789", name: "general", type: 0, topic: "General discussion" },
      }),
    ).toBe(`You are a helpful assistant.\n\n<discord_context>
  <guild id="123456" />
  <channel id="789" name="general" type="0" topic="General discussion" />
</discord_context>`);
  });

  it("should inject guild with name", () => {
    expect(
      formatDiscordContext({
        guild: { id: "123", name: "My Server" },
        channel: { id: "789", name: "dev" },
      }),
    ).toBe(`<discord_context>
  <guild id="123" name="My Server" />
  <channel id="789" name="dev" />
</discord_context>`);
  });

  it("should skip injection when disabled", () => {
    expect(appendDiscordContext("System", { guild: { id: "123" } }, false)).toBe("System");
  });

  it("should skip injection when context is undefined", () => {
    expect(formatDiscordContext({})).toBeUndefined();
  });

  it("should skip injection when both guild and channel are undefined", () => {
    expect(appendDiscordContext(undefined, {})).toBeUndefined();
  });

  it("should inject only guild when channel is missing", () => {
    expect(formatDiscordContext({ guild: { id: "123", name: "Server" } })).toBe(`<discord_context>
  <guild id="123" name="Server" />
</discord_context>`);
  });

  it("should inject only channel when guild is missing", () => {
    expect(formatDiscordContext({ channel: { id: "789", name: "general", type: 0 } }))
      .toBe(`<discord_context>
  <channel id="789" name="general" type="0" />
</discord_context>`);
  });

  it("should handle channel with only id", () => {
    expect(formatDiscordContext({ guild: { id: "123" }, channel: { id: "789" } }))
      .toBe(`<discord_context>
  <guild id="123" />
  <channel id="789" />
</discord_context>`);
  });

  it("should include topic when provided", () => {
    expect(
      formatDiscordContext({
        guild: { id: "123" },
        channel: { id: "789", topic: "Bug reports only" },
      }),
    ).toContain('topic="Bug reports only"');
  });

  it("should include type=0 (falsy but valid)", () => {
    expect(
      formatDiscordContext({ guild: { id: "123" }, channel: { id: "789", type: 0 } }),
    ).toContain('type="0"');
  });

  it("should append to existing system injection message", () => {
    expect(
      appendDiscordContext("Previous injected content", {
        guild: { id: "123" },
        channel: { id: "789", name: "general" },
      }),
    ).toBe(`Previous injected content\n\n<discord_context>
  <guild id="123" />
  <channel id="789" name="general" />
</discord_context>`);
  });

  it("should skip when no user message exists", () => {
    expect(formatDiscordContext({})).toBeUndefined();
  });

  it("informs the agent that Discord replies are delivered automatically", () => {
    expect(formatDiscordBotPlatformContext()).toContain(
      "automatically delivered to this conversation",
    );
  });
});
