import { describe, expect, it, vi } from "vitest";
import { createTopic, newMenuItems } from "./new-menu";

const context = (newConversation: () => void, newWith: (id: string) => void) => ({
  newConversation, newWith, trunks: [{ id: "oak", name: "Oak" }, { id: "elm", name: "Elm" }],
  newTrunk: vi.fn(), newChiefOfStaff: vi.fn(), openPlace: vi.fn(), makeTrunk: vi.fn(), quickAsk: vi.fn(),
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
  it("offers a premade Chief of Staff when creating a Trunk", () => {
    const c = context(vi.fn(), vi.fn());
    const item = newMenuItems(c).find((entry) => "label" in entry && entry.label === "Chief of Staff Trunk");
    expect(item).toMatchObject({ testid: "new-chief-of-staff" });
    if (item && "run" in item) item.run();
    expect(c.newChiefOfStaff).toHaveBeenCalledOnce();
  });

  it("rejects a blank first message without making an untitled session", async () => {
    const request = vi.fn();
    await expect(createTopic(request, "oak", "main", " \n ")).rejects.toThrow("Write a message");
    expect(request).not.toHaveBeenCalled();
  });

  it("creates an anchored conversation only with its first message", async () => {
    const request = vi.fn(async () => ({ key: "agent:oak:topic-2" }));
    const anchor = { threadKey: "agent:oak:main", afterMessageId: "entry-1" };
    expect(await createTopic(request, "oak", "main", "Follow up here", { contactAnchor: anchor })).toBe("agent:oak:topic-2");
    expect(request).toHaveBeenCalledExactlyOnceWith("sessions.create", {
      agentId: "oak", parentSessionKey: "agent:oak:main", message: "Follow up here",
      displayName: "Follow up here", titleSource: "Follow up here", contactAnchor: anchor,
    });
  });
});
