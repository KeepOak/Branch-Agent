import { describe, expect, it } from "vitest";
import { resolveTelegramTargetSession } from "../../extensions/telegram/src/conversation-route.js";
import { resolveTelegramMessageThreadSpec } from "../../extensions/telegram/src/bot/helpers.js";
import type { BranchConfig } from "../config/types.js";
import { contactIdForSession } from "../gateway/contacts/project.js";
import { resolveAgentRoute } from "./resolve-route.js";
import { resolveThreadSessionKeys } from "./session-key.js";

describe("Telegram contact routing", () => {
  const cfg: BranchConfig = {
    agents: { ownership: "explicit", defaultId: "oak", entries: { oak: {}, elm: {} } },
    channels: { telegram: { accounts: { default: {}, elm_bot: {} } } },
    bindings: [{ agentId: "elm", match: { channel: "telegram", accountId: "elm_bot" } }],
  };

  function target(accountId: string, dmThreadId?: number) {
    const route = resolveAgentRoute({
      cfg,
      channel: "telegram",
      accountId,
      peer: { kind: "direct", id: "42001" },
    });
    return {
      route,
      sessionKey: resolveTelegramTargetSession({
        cfg,
        route,
        chatId: 42001,
        isGroup: false,
        dmThreadId,
        botHasTopicsEnabled: true,
      }),
    };
  }

  it("routes each bot account's ordinary DM to its Trunk contact thread", () => {
    expect(target("default").sessionKey).toBe("agent:oak:main");
    const bound = target("elm_bot");
    expect(bound.route.matchedBy).toBe("binding.account");
    expect(bound.sessionKey).toBe("agent:elm:main");
  });

  it("routes a private-chat topic under that contact but keeps General and root in main", () => {
    const topicKey = target("elm_bot", 42).sessionKey;
    expect(topicKey).toBe("agent:elm:main:thread:42001:42");
    expect(contactIdForSession({ sessionKey: topicKey, entry: {} } as Parameters<typeof contactIdForSession>[0]))
      .toBe("trunk:elm");
    expect(target("elm_bot", 1).sessionKey).toBe("agent:elm:main");
    expect(target("elm_bot").sessionKey).toBe("agent:elm:main");
    expect(resolveThreadSessionKeys({ baseSessionKey: "agent:elm:main", threadId: "__root__" }))
      .toEqual({ sessionKey: "agent:elm:main", parentSessionKey: undefined });
  });

  it("reads Telegram private-chat thread IDs without confusing channel Direct Messages topics", () => {
    const privateMessage = {
      chat: { id: 42001, type: "private" }, message_thread_id: 42, is_topic_message: true,
    } as Parameters<typeof resolveTelegramMessageThreadSpec>[0];
    const thread = resolveTelegramMessageThreadSpec(privateMessage);
    expect(thread).toEqual({ scope: "dm", id: 42 });
    expect(target("elm_bot", thread.id).sessionKey).toBe("agent:elm:main:thread:42001:42");
  });

  it("does not split a DM when the bot has no private-chat topics", () => {
    const { route } = target("elm_bot");
    expect(resolveTelegramTargetSession({
      cfg, route, chatId: 42001, isGroup: false, dmThreadId: 42,
      botHasTopicsEnabled: false,
    })).toBe("agent:elm:main");
  });

  it("keeps Telegram groups separate from private contact threads", () => {
    const route = resolveAgentRoute({
      cfg, channel: "telegram", accountId: "elm_bot",
      peer: { kind: "group", id: "-10042001" },
    });
    expect(route.sessionKey).toBe("agent:elm:telegram:group:-10042001");
  });
});
