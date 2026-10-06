import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeRelayTransports } from "./gateway.js";
import { sendRelayText } from "./outbound.js";
import { buildRelayTarget, parseRelayTarget } from "./target.js";

vi.mock("./gateway.js", () => ({
  activeRelayTransports: new Map(),
  relayScopeFor: () => ({}),
}));

describe("relay restart notice destination", () => {
  afterEach(() => activeRelayTransports.clear());
  it("keeps the logical conversation stable while preserving connector identity in the delivery target", () => {
    const peer = buildRelayTarget({ platform: "slack", chatType: "direct", chatId: "D123" });
    const delivery = buildRelayTarget({
      platform: "slack", chatType: "direct", chatId: "D123", scopeId: "T123", userId: "U123",
    });
    expect(peer).toBe("slack:direct:D123");
    expect(delivery).toBe("slack:direct:D123?scope_id=T123&user_id=U123");
    expect(parseRelayTarget(delivery)).toEqual({
      platform: "slack", chatType: "direct", chatId: "D123", scopeId: "T123", userId: "U123",
    });
  });

  it("round-trips thread owner IDs containing URL punctuation", () => {
    const target = buildRelayTarget({
      platform: "slack", chatType: "group", chatId: "C123", scopeId: "team/a&b", userId: "user?7",
    });
    expect(parseRelayTarget(target)).toMatchObject({ scopeId: "team/a&b", userId: "user?7" });
  });

  it("sends a persisted requester and thread through the relay after its in-memory scope is gone", async () => {
    const sendOutbound = vi.fn(async () => ({ success: true, message_id: "notice-1" }));
    activeRelayTransports.set("default", {
      descriptorFor: () => undefined,
      sendOutbound,
    } as never);
    const cfg = { channels: { "chat-relay": {
      enabled: true, url: "https://connector.example", platform: "slack", botId: "app-1",
    } } } as BranchConfig;
    const to = buildRelayTarget({
      platform: "slack", chatType: "direct", chatId: "D123", scopeId: "T123", userId: "U123",
    });
    await expect(sendRelayText({ cfg, to, text: "Gateway back online", threadId: "thread-7" }))
      .resolves.toBe("notice-1");
    expect(sendOutbound).toHaveBeenCalledWith({
      op: "send", chat_id: "D123", content: "Gateway back online", reply_to: null,
      metadata: { thread_id: "thread-7", scope_id: "T123", user_id: "U123" },
    }, "slack");
  });
});
