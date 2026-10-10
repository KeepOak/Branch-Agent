// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
    row, isMain: false, trunkName: "Researcher", ownTrunk: true, canRemoveTrunk: true, online: true,
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

function rowNamed(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("[data-testid=conversation-menu] > button.mi")].find((button) =>
    [...button.querySelectorAll("span")].some((span) => span.textContent === label),
  );
}

function viewRow(host: HTMLElement) {
  return host.querySelector<HTMLButtonElement>("[data-testid=conversation-view]")
    ?? [...host.querySelectorAll<HTMLButtonElement>("[data-testid=conversation-menu] > button.mi[aria-haspopup=menu]")].find((button) =>
      [...button.querySelectorAll("span")].some((span) => span.textContent === "View"),
    );
}

describe("conversation ⋯ View layout", () => {
  it("does not open a View flyout on hover that covers Side panel or Open the browser", async () => {
    const host = await show();
    const view = viewRow(host)!;
    expect(view).toBeTruthy();
    await act(async () => view.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await act(async () => view.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })));
    expect(host.querySelector("[role=menu][aria-label=View]")).toBeNull();
    expect(host.textContent).not.toContain("Researcher’s threads show as");
    const side = rowNamed(host, "Side panel")!;
    const browser = rowNamed(host, "Open the browser")!;
    expect(side).toBeTruthy();
    expect(browser).toBeTruthy();
    await act(async () => side.click());
    await act(async () => browser.click());
  });

  it("opens the thread-layout choices when View is clicked", async () => {
    const host = await show();
    await act(async () => viewRow(host)!.click());
    const flyout = host.querySelector("[role=menu][aria-label=View]");
    expect(flyout?.textContent).toContain("Researcher’s threads show as");
    expect(flyout?.textContent).toContain("Column");
  });
});
