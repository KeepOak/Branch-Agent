import { afterEach, expect, it, vi } from "vitest";
import { conversationLink, openConversationWindow, ownWindowUnavailable } from "./own-window";

afterEach(() => {
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.restoreAllMocks();
});

it("sends a conversation key to the desktop's owned-window bridge", async () => {
  const openConversation = vi.fn(async () => undefined);
  (window as { branchDesktop?: unknown }).branchDesktop = { openConversation };
  await openConversationWindow("agent:oak:topic:one");
  expect(openConversation).toHaveBeenCalledWith("agent:oak:topic:one");
});

it("opens a conversation URL in a separate browser window without the desktop bridge", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  await openConversationWindow("agent:oak:topic:one");
  expect(open).toHaveBeenCalledWith(conversationLink("agent:oak:topic:one"), "_blank", "noopener");
});

it("marks older desktop apps unavailable instead of asking them to open a blocked browser popup", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = {};
  expect(ownWindowUnavailable()).toMatch(/newer Branch desktop app/);
  await expect(openConversationWindow("agent:oak:main")).rejects.toThrow(/newer Branch desktop app/);
});
