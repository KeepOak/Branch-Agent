// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { CanopyPlace } from "../canopy";
import { BoardTab } from "./Board";

vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });
async function mount(canopy = false, cardsFail = false, queueFail = false) {
  let status = "claimed";
  const openConversation = vi.fn();
  const request = vi.fn(async (method: string) => {
    if (method === "trunks.queue.list") {
      if (queueFail) throw new Error("Unavailable");
      return { items: [{ id: "q", title: "Ship the report", brief_text: "Check the totals", status, claimed_by: "a", thread_key: "agent:a:job" }] };
    }
    if (method === "canopy.cards.list") {
      if (cardsFail) throw new Error("Cards unavailable");
      return { cards: [{ id: "c", title: "Plan the report", status: "todo", updatedAt: 1 }], boards: [] };
    }
    if (method === "agents.list") return { agents: [{ id: "a", name: "Juniper" }] };
    return {};
  });
  const engine = { request, scopes: ["operator.read"], onEvent: () => () => {}, sessionKey: null } as unknown as WindowEngine;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const View = canopy ? CanopyPlace : BoardTab;
  await act(async () => root!.render(<View facts={{ running: 0, waiting: 0 }} engine={engine} level="regular" openConversation={openConversation} openPlace={vi.fn()} />));
  return { request, openConversation, setStatus: (value: string) => { status = value; } };
}
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
it.each([false, true])("LP-01 shares queue status and conversation links (Canopy: %s)", async canopy => {
  const { openConversation, setStatus, request } = await mount(canopy);
  if (canopy) await act(async () => button("Cards").click());
  expect(host.textContent).toContain("Ship the report");
  expect(host.textContent).toContain("Working · Juniper");
  await act(async () => button("Open conversation").click());
  expect(openConversation).toHaveBeenCalledWith("agent:a:job");
  expect(host.textContent).toContain("Plan the report");
  setStatus("done");
  await act(async () => button("Refresh work").click());
  expect(host.textContent).toContain("Done · Juniper");
  expect(request.mock.calls.every(([method]) => !/canopy\.cards\.(create|move)|trunks\.queue\.(done|release)/.test(method))).toBe(true);
});
it("keeps queue work visible when the cards source fails", async () => {
  await mount(false, true);
  expect(host.textContent).toContain("Ship the report");
  expect(host.textContent).toContain("Cards unavailable");
});
it("reports a failed queue source instead of claiming there are no jobs", async () => {
  await mount(false, false, true);
  expect(host.textContent).toContain("queue couldn’t be loaded");
  expect(host.textContent).not.toContain("No queued jobs");
  expect(host.textContent).toContain("Plan the report");
});
it("refreshes queue status without needing a Canopy event", async () => {
  vi.useFakeTimers();
  const { setStatus } = await mount();
  setStatus("blocked");
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(host.textContent).toContain("Blocked · Juniper");
});
