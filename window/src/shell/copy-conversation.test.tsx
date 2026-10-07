import { describe, expect, it, vi } from "vitest";
import { ConversationList, type Conversation } from "../connect/conversations";
import { conversationActions } from "./conversation-actions";
import { rowMenuItems } from "./row-menu";

const key = "agent:research:abc";
const row = (working: boolean): Conversation => ({
  key, sessionId: "session-1", title: "Research", agentId: "research", done: false,
  isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: 0, updatedAt: 0, preview: "", working, kind: "direct",
  system: false, automation: false, totalTokens: 0, contextTokens: 0,
});

function menu(working: boolean, actions: ReturnType<typeof conversationActions>, copyConversation: (row: Conversation) => void) {
  return rowMenuItems(row(working), {
    actions, now: Date.now(), trunkName: "Research", level: "regular",
    open: () => {}, ownWindow: () => {}, rename: () => {}, confirmDelete: () => {},
    ask: () => {}, editTrunk: () => {}, tidy: () => {}, copyMarkdown: () => {},
    copyText: () => {}, copyLink: () => {}, copyConversation,
  });
}

describe("copy conversation", () => {
  it("enables Copy into a new conversation and calls sessions.fork with the last finished entry", async () => {
    const messages = [
      { role: "user", content: [], __branch: { id: "e1" } },
      { role: "assistant", content: [], __branch: { id: "e2" } },
      { role: "user", content: [], __branch: { id: "e3" } },
      { role: "assistant", content: [], __branch: { id: "e4" } },
    ];
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { messages };
      if (method === "sessions.fork") return { sessionKey: "agent:research:xyz" };
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = conversationActions(request, { refresh } as unknown as ConversationList, () => null);

    const items = menu(false, actions, (r) => actions.copyConversation(r, open));
    const forkItem = items.find((item) => item.kind === undefined && item.label === "Copy into a new conversation");
    expect(forkItem).toMatchObject({ label: "Copy into a new conversation", letter: "f" });
    expect(forkItem && "disabled" in forkItem ? forkItem.disabled : undefined).toBeUndefined();
    expect(forkItem && "testid" in forkItem ? forkItem.testid : undefined).toBe("menu-fork");

    if (!forkItem || forkItem.kind !== undefined) throw new Error("Fork item is missing");
    await forkItem.run();

    expect(request).toHaveBeenNthCalledWith(1, "chat.history", { sessionKey: key, agentId: "research" });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.fork", { key, agentId: "research", expectedSessionId: "session-1", entryId: "e4" });
    expect(request).toHaveBeenNthCalledWith(3, "sessions.patch", { key: "agent:research:xyz", label: "Research (copy)" });
    expect(refresh).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("agent:research:xyz");
  });

  it("copies up to the last finished assistant entry when the conversation is working", async () => {
    const messages = [
      { role: "user", content: [], __branch: { id: "e1" } },
      { role: "assistant", content: [], __branch: { id: "e2" } },
      { role: "user", content: [], __branch: { id: "e3" } },
    ];
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { messages };
      if (method === "sessions.fork") return { sessionKey: "agent:research:xyz" };
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = conversationActions(request, { refresh } as unknown as ConversationList, () => null);

    const items = menu(true, actions, (r) => actions.copyConversation(r, open));
    const forkItem = items.find((item) => item.kind === undefined && item.label === "Copy into a new conversation");
    expect(forkItem).toMatchObject({ label: "Copy into a new conversation", letter: "f", hint: "From the last finished reply" });
    expect(forkItem && "disabled" in forkItem ? forkItem.disabled : undefined).toBeUndefined();

    if (!forkItem || forkItem.kind !== undefined) throw new Error("Fork item is missing");
    await forkItem.run();

    expect(request).toHaveBeenCalledWith("sessions.fork", { key, agentId: "research", expectedSessionId: "session-1", entryId: "e2" });
  });

  it("shows an error when the conversation has no finished entries", async () => {
    const messages = [
      { role: "user", content: [], __branch: { id: "e1" } },
    ];
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { messages };
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = conversationActions(request, { refresh } as unknown as ConversationList, () => null);

    await actions.copyConversation(row(true), open);

    expect(request).toHaveBeenCalledWith("chat.history", { sessionKey: key, agentId: "research" });
    expect(request).not.toHaveBeenCalledWith("sessions.fork", expect.any(Object));
    expect(open).not.toHaveBeenCalled();
  });
});
