import { describe, expect, it, vi } from "vitest";
import { createTopic, newMenuItems } from "./new-menu";

const context = (newConversation: () => void, newWith: (id: string) => void) => ({
  newConversation, newWith, trunks: [{ id: "oak", name: "Oak" }, { id: "elm", name: "Elm" }],
  newTrunk: vi.fn(), openPlace: vi.fn(), makeTrunk: vi.fn(), quickAsk: vi.fn(),
});

describe("new conversation drafts", () => {
  it("New conversation and New conversation with a Trunk only select an unsaved composer", async () => {
    const request = vi.fn(async () => ({ key: "agent:elm:topic-1" }));
    const draft = vi.fn();
    const items = newMenuItems(context(() => draft("oak"), draft));
    const run = (label: string) => {
      const item = items.find((entry) => "label" in entry && entry.label === label);
      if (item && "run" in item) item.run();
    };
    run("New conversation");
    run("New conversation with Elm");
    expect(draft.mock.calls).toEqual([["oak"], ["elm"]]);
    expect(request).not.toHaveBeenCalled();

    expect(await createTopic(request, "elm", "home", "  First job for Elm  ")).toBe("agent:elm:topic-1");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.create", {
      agentId: "elm", parentSessionKey: "agent:elm:home",
      message: "First job for Elm", displayName: "First job for Elm", titleSource: "First job for Elm",
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.describe", { key: "agent:elm:home" });
  });

  it("mirrors a first-message conversation to its Trunk's private Telegram chat", async () => {
    const request = vi.fn(async (method: string) => method === "sessions.create"
      ? { key: "agent:elm:topic-1" }
      : method === "sessions.describe"
        ? { session: { deliveryContext: { channel: "telegram", to: "telegram:42001", accountId: "elm_bot" } } }
        : { ok: true, mirrored: true });
    expect(await createTopic(request, "elm", "home", "  Plan the trip  ")).toBe("agent:elm:topic-1");
    expect(request).toHaveBeenNthCalledWith(3, "message.action", {
      channel: "telegram", action: "topic-create", sessionKey: "agent:elm:topic-1",
      idempotencyKey: "contact-topic:agent:elm:topic-1",
      params: { chatId: "42001", name: "Plan the trip", contactTopicMirror: true, accountId: "elm_bot" },
    });
  });

  it("does not mirror a group destination", async () => {
    const request = vi.fn(async (method: string) => method === "sessions.create"
      ? { key: "agent:elm:topic-1" }
      : { session: { deliveryContext: { channel: "telegram", to: "telegram:-10042001" } } });
    await createTopic(request, "elm", "main", "New task");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["sessions.create", "sessions.describe"]);
  });

  it("rejects a blank first message without making an untitled session", async () => {
    const request = vi.fn();
    await expect(createTopic(request, "oak", "main", " \n ")).rejects.toThrow("Write a message");
    expect(request).not.toHaveBeenCalled();
  });
});
