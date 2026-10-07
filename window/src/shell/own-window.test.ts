import { afterEach, expect, it, vi } from "vitest";
import { changeConversationInOwnWindow, conversationLink, forgetDeletedConversationWindow, openConversationWindow, ownWindowUnavailable, restoreSavedConversationWindows, retrySavedConversationWindows } from "./own-window";

afterEach(() => {
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.useRealTimers();
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
  const navigate = vi.fn();
  await expect(changeConversationInOwnWindow("agent:oak:other", navigate)).rejects.toThrow(/newer Branch desktop app/);
  expect(navigate).not.toHaveBeenCalled();
});

it("keeps the route unchanged when a pop-out retarget is refused", async () => {
  const navigate = vi.fn();
  const retargetConversationWindow = vi.fn(async () => { throw new Error("That conversation already has a window"); });
  (window as { branchDesktop?: unknown }).branchDesktop = { retargetConversationWindow };
  await expect(changeConversationInOwnWindow("agent:oak:other", navigate)).rejects.toThrow("already has a window");
  expect(navigate).not.toHaveBeenCalled();
  expect(retargetConversationWindow).toHaveBeenCalledWith("agent:oak:other");
});

it("restores only saved pop-outs whose conversations still exist", async () => {
  const saved = vi.fn(async () => ["agent:oak:one", "agent:oak:deleted"]);
  const restore = vi.fn(async () => undefined);
  const forget = vi.fn(async () => undefined);
  (window as { branchDesktop?: unknown }).branchDesktop = { conversationWindows: { saved, restore, forget } };
  const request = vi.fn(async (_method: string, params: unknown) => ({ session: (params as { key: string }).key.endsWith("deleted") ? null : { key: "agent:oak:one" } }));
  await restoreSavedConversationWindows(request);
  expect(restore).toHaveBeenCalledWith(["agent:oak:one"], []);
  expect(request).toHaveBeenCalledWith("sessions.describe", { key: "agent:oak:one", agentId: "oak" });
  await forgetDeletedConversationWindow("agent:oak:one");
  expect(forget).toHaveBeenCalledWith("agent:oak:one");
});

it("drops a deleted Trunk pop-out without blocking other saved conversations", async () => {
  const restore = vi.fn(async () => undefined);
  (window as { branchDesktop?: unknown }).branchDesktop = { conversationWindows: { saved: async () => ["agent:retired:main", "agent:oak:one"], restore } };
  const request = vi.fn(async (_method: string, params: unknown) => {
    if ((params as { key: string }).key === "agent:retired:main") throw Object.assign(new Error("agent was removed"), { code: "INVALID_REQUEST" });
    return { session: { key: "agent:oak:one" } };
  });
  expect(await restoreSavedConversationWindows(request)).toBe(false);
  expect(restore).toHaveBeenCalledWith(["agent:oak:one"], []);
});

it("retries a deferred restore until the read succeeds, even when a transient error mentions an unknown agent", async () => {
  vi.useFakeTimers();
  let savedKeys = ["agent:oak:preparing"];
  const restore = vi.fn(async (existing: string[], deferred: string[]) => { savedKeys = [...existing, ...deferred]; });
  (window as { branchDesktop?: unknown }).branchDesktop = { conversationWindows: { saved: async () => savedKeys, restore } };
  const request = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('Unknown agent id "oak"'), { code: "UNAVAILABLE" }))
    .mockResolvedValueOnce({ session: { key: "agent:oak:preparing" } });

  const stop = retrySavedConversationWindows(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(restore).toHaveBeenNthCalledWith(1, [], ["agent:oak:preparing"]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(restore).toHaveBeenNthCalledWith(2, ["agent:oak:preparing"], []);
  expect(request).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledTimes(2);
});

it("defers a temporarily refused pop-out and restores the others", async () => {
  const restore = vi.fn(async () => undefined);
  (window as { branchDesktop?: unknown }).branchDesktop = { conversationWindows: { saved: async () => ["agent:oak:preparing", "agent:oak:one"], restore } };
  const request = vi.fn(async (_method: string, params: unknown) => {
    if ((params as { key: string }).key.endsWith("preparing")) throw new Error("Agent database is being prepared");
    return { session: { key: "agent:oak:one" } };
  });
  expect(await restoreSavedConversationWindows(request)).toBe(true);
  expect(restore).toHaveBeenCalledWith(["agent:oak:one"], ["agent:oak:preparing"]);
});
