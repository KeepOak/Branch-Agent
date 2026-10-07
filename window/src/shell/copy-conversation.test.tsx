import { describe, expect, it, vi } from "vitest";
import { ConversationList, LIST_PARAMS, type Conversation } from "../connect/conversations";
import type { Contact } from "./contacts-model";
import { conversationActions } from "./conversation-actions";
import { rowMenuItems } from "./row-menu";

const key = "agent:research:abc";
const row = (working: boolean): Conversation => ({
  key, sessionId: "session-1", title: "Research", agentId: "research", done: false,
  isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: 0, updatedAt: 0, preview: "", working, kind: "direct",
  system: false, automation: false, totalTokens: 0, contextTokens: 0,
});

function menu(working: boolean, actions: ReturnType<typeof conversationActions>, copyConversation: (row: Conversation) => void | Promise<void>) {
  return rowMenuItems(row(working), {
    actions, now: Date.now(), trunkName: "Research", level: "regular",
    open: () => {}, ownWindow: () => {}, rename: () => {}, confirmDelete: () => {},
    ask: () => {}, editTrunk: () => {}, tidy: () => {}, copyMarkdown: () => {},
    copyText: () => {}, copyLink: () => {}, copyConversation,
  });
}

function actionsOf(request: Parameters<typeof conversationActions>[0], refresh: () => Promise<void>) {
  return conversationActions(request, { refresh } as unknown as ConversationList, () => null);
}

describe("copy conversation", () => {
  it("enables Copy into a new conversation and forks the whole idle thread", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") return { key: "agent:research:xyz" };
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = actionsOf(request, refresh);

    const items = menu(false, actions, (r) => actions.copyConversation(r, open));
    const forkItem = items.find((item) => item.kind === undefined && item.label === "Copy into a new conversation");
    expect(forkItem).toMatchObject({ label: "Copy into a new conversation", letter: "f" });
    expect(forkItem && "disabled" in forkItem ? forkItem.disabled : undefined).toBeUndefined();
    expect(forkItem && "testid" in forkItem ? forkItem.testid : undefined).toBe("menu-fork");

    if (!forkItem || forkItem.kind !== undefined) throw new Error("Fork item is missing");
    await forkItem.run();

    expect(request).toHaveBeenCalledWith("sessions.create", { parentSessionKey: key, fork: true, agentId: "research" });
    expect(request).toHaveBeenCalledWith("sessions.list", LIST_PARAMS);
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:research:xyz", label: "Research (copy)" });
    expect(refresh).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("agent:research:xyz");
  });

  it("uses a unique (copy N) label when the default copy name is already taken", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") return { key: "agent:research:xyz" };
      if (method === "sessions.list") {
        return {
          sessions: [
            { key, displayName: "Research" },
            { key: "agent:research:copy-1", displayName: "Research (copy)" },
          ],
        };
      }
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = actionsOf(request, refresh);

    await actions.copyConversation(row(false), open);

    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:research:xyz", label: "Research (copy 2)" });
    expect(open).toHaveBeenCalledWith("agent:research:xyz");
  });

  it("copies from the last finished reply when the conversation is working", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") return { key: "agent:research:xyz" };
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = actionsOf(request, refresh);

    const items = menu(true, actions, (r) => actions.copyConversation(r, open));
    const forkItem = items.find((item) => item.kind === undefined && item.label === "Copy into a new conversation");
    expect(forkItem).toMatchObject({ label: "Copy into a new conversation", letter: "f", hint: "From the last finished reply" });
    expect(forkItem && "disabled" in forkItem ? forkItem.disabled : undefined).toBeUndefined();

    if (!forkItem || forkItem.kind !== undefined) throw new Error("Fork item is missing");
    await forkItem.run();

    expect(request).toHaveBeenCalledWith("sessions.create", {
      parentSessionKey: key, fork: true, forkFrom: "last-completed", agentId: "research",
    });
  });

  it("shows an error when the engine refuses the copy", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("nothing finished to copy");
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = actionsOf(request, refresh);

    await actions.copyConversation(row(true), open);

    expect(request).toHaveBeenCalledWith("sessions.create", {
      parentSessionKey: key, fork: true, forkFrom: "last-completed", agentId: "research",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("enables Copy into a new conversation on a contact row and forks that thread", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") return { key: "agent:research:xyz" };
      return {};
    }) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const open = vi.fn();
    const actions = actionsOf(request, refresh);
    const thread = row(false);
    const contact: Contact = {
      id: "trunk:research", kind: "trunk", name: "Research", threadKey: key, isDefault: false,
      lastActivityAt: 0, preview: { kind: "message", text: "", at: 0 }, unreadTopics: 0,
      threadUnread: false, needsYou: false, working: false, topicCount: 0, thread,
    };
    const items = rowMenuItems(thread, {
      actions, now: Date.now(), trunkName: "Research", level: "regular",
      open: () => {}, ownWindow: () => {}, rename: () => {}, confirmDelete: () => {},
      ask: () => {}, editTrunk: () => {}, tidy: () => {}, copyMarkdown: () => {},
      copyText: () => {}, copyLink: () => {}, copyConversation: (r) => actions.copyConversation(r, open),
      contact,
    });
    const forkItem = items.find((item) => item.kind === undefined && item.label === "Copy into a new conversation");
    expect(forkItem).toMatchObject({ label: "Copy into a new conversation", letter: "f" });
    expect(forkItem && "disabled" in forkItem ? forkItem.disabled : undefined).toBeUndefined();
    if (!forkItem || forkItem.kind !== undefined) throw new Error("Fork item is missing");
    await forkItem.run();
    expect(request).toHaveBeenCalledWith("sessions.create", { parentSessionKey: key, fork: true, agentId: "research" });
    expect(open).toHaveBeenCalledWith("agent:research:xyz");
  });
});
