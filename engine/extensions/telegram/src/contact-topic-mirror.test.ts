import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { createPluginRuntimeMock } from "branch/plugin-sdk/channel-test-helpers";
import type { PluginStateKeyedStore } from "branch/plugin-sdk/plugin-state-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { telegramPlugin } from "./channel.js";
import { peekContactTopicMirror, resetContactTopicMirrorsForTest } from "./contact-topic-mirror.js";
import {
  resolveTelegramConversationRoute,
  resolveTelegramTargetSession,
} from "./conversation-route.js";
import { useTelegramHttpFixture } from "./send.telegram-http.test-support.js";
import { setTelegramRuntime } from "./runtime.js";
import { clearTelegramRuntimeForTest } from "./runtime.test-support.js";

describe("Telegram contact topic mirror", () => {
  const fixture = useTelegramHttpFixture();
  let cfg: BranchConfig;
  const stored = new Map<string, { sessionKey: string }>();

  beforeEach(() => {
    cfg = {
      ...fixture.cfg,
      agents: { ownership: "explicit", defaultId: "elm", entries: { elm: {} } },
    };
    resetContactTopicMirrorsForTest();
    stored.clear();
    setTelegramRuntime(createPluginRuntimeMock({
      state: {
        openKeyedStore: <T>() => ({
          entries: async () => [...stored].map(([key, value]) => ({ key, value: value as T })),
          register: async (key: string, value: T) => { stored.set(key, value as { sessionKey: string }); },
        }) as PluginStateKeyedStore<T>,
      },
    }));
  });

  afterEach(() => {
    resetContactTopicMirrorsForTest();
    clearTelegramRuntimeForTest();
  });

  async function createMirror(topicsEnabled: boolean) {
    fixture.responseFor = (method) => method === "getMe"
      ? { id: 700, is_bot: true, first_name: "Elm", username: "elm_bot", has_topics_enabled: topicsEnabled }
      : method === "createForumTopic"
        ? { message_thread_id: 42, name: "Plan the trip", icon_color: 7322096 }
        : undefined;
    return telegramPlugin.actions!.handleAction!({
      channel: "telegram", action: "topic-create", cfg,
      accountId: "default", conversationReadOrigin: "direct-operator",
      sessionKey: "agent:elm:trip",
      params: { chatId: "42001", name: "Plan the trip", contactTopicMirror: true },
    });
  }

  it("creates one private topic and routes its next message to the window conversation", async () => {
    await createMirror(true);
    expect(fixture.requests.map(({ method }) => method)).toEqual(["getMe", "createForumTopic"]);
    expect(fixture.requests[1]?.fields).toMatchObject({ chat_id: "42001", name: "Plan the trip" });
    const { route, contactTopicMirror } = await resolveTelegramConversationRoute({
      cfg, accountId: "default", chatId: 42001, isGroup: false,
      senderId: "42001", threadSpec: { scope: "dm", id: 42 },
    });
    expect(contactTopicMirror).toBe(true);
    expect(resolveTelegramTargetSession({
      cfg, route, chatId: 42001, isGroup: false, dmThreadId: 42,
      botHasTopicsEnabled: true, preserveBoundTopic: true,
    })).toBe("agent:elm:trip");
    resetContactTopicMirrorsForTest();
    expect((await resolveTelegramConversationRoute({
      cfg, accountId: "default", chatId: 42001, isGroup: false,
      senderId: "42001", threadSpec: { scope: "dm", id: 42 },
    })).route.sessionKey).toBe("agent:elm:trip");
  });

  it("does not create or bind a topic when private-chat topics are off", async () => {
    await createMirror(false);
    expect(fixture.requests.map(({ method }) => method)).toEqual(["getMe"]);
    expect(peekContactTopicMirror({ accountId: "default", chatId: 42001, threadId: 42 }))
      .toBeUndefined();
  });
});
