// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationMenuItems, type ConversationMenuContext, type ConversationMenuRun } from "./conversation-menu";
import { Menu } from "./Menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const run = new Proxy({}, { get: () => () => undefined }) as ConversationMenuRun;
const row = {
  key: "agent:research:abc", title: "Research", agentId: "research", isMain: false, pinned: true, archived: false, unread: false, snoozedUntil: null,
  createdAt: 0, updatedAt: 0, preview: "", working: false, kind: "direct" as const, system: false, automation: false, totalTokens: 0, contextTokens: 0, sessionId: "s1",
};
function items() {
  const ctx: ConversationMenuContext = {
    row, isMain: false, trunkName: "Researcher", ownTrunk: true, canRemoveTrunk: true, mac: true,
    now: new Date(2026, 9, 1, 9, 0).getTime(), hasReply: true, talkOff: null, run,
    threadView: { contactName: "Researcher", layout: "column", set: () => undefined },
  };
  return conversationMenuItems(ctx);
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show() {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Menu, { at: { x: 0, y: 0 }, items: items(), onClose: () => undefined, label: "Conversation", testid: "conversation-menu" })));
  return host;
}

/** The menu row (button) whose label reads `label`, in the top menu or any open flyout. */
function rowNamed(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button.mi")].find((button) => button.querySelector("span")?.textContent === label);
}

function flyout(host: HTMLElement, label: string) {
  return host.querySelector<HTMLElement>(`[role=menu][aria-label="${label}"]`);
}

describe("conversation ⋯ More and View", () => {
  it("closes the whole menu when a row two flyouts deep runs", async () => {
    const closed = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(createElement(Menu, { at: { x: 0, y: 0 }, items: items(), onClose: closed, label: "Conversation", testid: "conversation-menu" })));
    await act(async () => rowNamed(host, "More")!.click());
    await act(async () => rowNamed(host, "View")!.click());
    await act(async () => rowNamed(host, "Side panel")!.click());
    expect(closed).toHaveBeenCalled();
  });

  it("opens More, then View, which holds Side panel and Open the browser", async () => {
    const host = await show();
    expect(flyout(host, "Conversation")?.textContent).not.toContain("Side panel");
    await act(async () => rowNamed(host, "More")!.click());
    expect(flyout(host, "More")).toBeTruthy();
    await act(async () => rowNamed(host, "View")!.click());
    const view = flyout(host, "View");
    expect(view?.textContent).toContain("Side panel");
    expect(view?.textContent).toContain("Open the browser");
  });

  it("keeps the thread-layout choices click-only inside View", async () => {
    const host = await show();
    await act(async () => rowNamed(host, "More")!.click());
    await act(async () => rowNamed(host, "View")!.click());
    const threads = rowNamed(host, "Threads show as")!;
    await act(async () => threads.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })));
    expect(flyout(host, "Threads show as")).toBeNull();
    await act(async () => threads.click());
    expect(flyout(host, "Threads show as")?.textContent).toContain("Researcher’s threads show as");
    expect(flyout(host, "Threads show as")?.textContent).toContain("Column");
  });
});
