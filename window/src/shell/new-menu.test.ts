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
    expect(request).toHaveBeenCalledExactlyOnceWith("sessions.create", {
      agentId: "elm", parentSessionKey: "agent:elm:home",
      message: "First job for Elm", displayName: "First job for Elm", titleSource: "First job for Elm",
    });
  });

  it("rejects a blank first message without making an untitled session", async () => {
    const request = vi.fn();
    await expect(createTopic(request, "oak", "main", " \n ")).rejects.toThrow("Write a message");
    expect(request).not.toHaveBeenCalled();
  });
});
