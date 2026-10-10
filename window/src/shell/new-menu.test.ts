// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";
import { createTopic, newMenuItems } from "./new-menu";

const context = (newWith: (id: string) => void) => ({
  newWith, trunks: [{ id: "elm", name: "Builder Elm" }, { id: "oak", name: "TK" }], defaultId: "oak",
  newTrunk: vi.fn(), fromJob: vi.fn(),
});

const labels = (items: ReturnType<typeof newMenuItems>) => items.map((entry) => "label" in entry ? entry.label : entry.kind);

describe("the one New menu", () => {
  it("offers exactly New conversation and New Trunk, and New Trunk asks blank or from a job", () => {
    const ctx = context(vi.fn());
    const items = newMenuItems(ctx);
    expect(labels(items)).toEqual(["New conversation", "New Trunk"]);
    const trunk = items[1];
    if (trunk.kind !== "sub") throw new Error("New Trunk should ask how to start");
    expect(labels(trunk.items)).toEqual(["Blank", "From a job…"]);
    for (const item of trunk.items) if ("run" in item) item.run();
    expect(ctx.newTrunk).toHaveBeenCalledOnce();
    expect(ctx.fromJob).toHaveBeenCalledOnce();
  });
});

describe("new conversation drafts", () => {
  it("opens the Trunk chooser on hover and selects one Trunk", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const draft = vi.fn();
    const close = vi.fn();
    try {
      await act(async () => root.render(createElement(Menu, { at: { x: 0, y: 0 }, items: newMenuItems(context(draft)), onClose: close, label: "New" })));
      const row = host.querySelector<HTMLButtonElement>('[data-testid="new-conversation"]')!;
      await act(async () => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      const chooser = host.querySelector<HTMLElement>('[role="menu"][aria-label="New conversation"]')!;
      expect(chooser).toBeTruthy();
      await act(async () => chooser.querySelector<HTMLButtonElement>('[data-testid="new-with-elm"]')!.click());
      expect(draft).toHaveBeenCalledExactlyOnceWith("elm");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("offers one New conversation chooser with the default Trunk first and unsaved drafts", async () => {
    const request = vi.fn(async () => ({ key: "agent:elm:topic-1" }));
    const draft = vi.fn();
    const items = newMenuItems(context(draft));
    expect(items.filter((entry) => "label" in entry && entry.label === "New conversation")).toHaveLength(1);
    const chooser = items[0];
    expect(chooser).toMatchObject({ kind: "sub", label: "New conversation", hint: "Ctrl N" });
    if (chooser.kind !== "sub") throw new Error("New conversation should open a chooser");
    expect(chooser.items.map((entry) => "label" in entry ? entry.label : "")).toEqual(["with TK (default)", "with Builder Elm"]);
    for (const item of chooser.items) if ("run" in item) item.run();
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
