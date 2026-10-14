// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { topicContactFor, useR1Topics } from "./Topics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = Date.now();
const conv = (key: string, patch: Partial<Conversation> = {}): Conversation => ({
  key, title: key, agentId: "ledger", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: NOW, updatedAt: NOW,
  preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...patch,
});
const rows = [
  conv("agent:ledger:main", { title: "Ledger", preview: "Morning." }),
  conv("agent:ledger:t1", { title: "Month-end close", parentKey: "agent:ledger:main", sessionId: "s1" }),
  conv("agent:ledger:t2", { title: "Card charges", parentKey: "agent:ledger:main", sessionId: "s2" }),
  conv("agent:scout:main", { agentId: "scout", title: "Scout" }),
];
const topics = [
  { key: "agent:ledger:t1", title: "Month-end close", labelled: true, status: "done", unread: false },
  { key: "agent:ledger:t2", title: "Card charges", labelled: true, status: "idle", unread: false },
];
let root: Root, host: HTMLDivElement, narrow = false;
beforeEach(() => {
  // Most of these draw the column, so they start in Freedom Mode; the Tabs test sets its own layout.
  localStorage.clear(); localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "free", width: 300, per: {} })); narrow = false;
  vi.stubGlobal("matchMedia", () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function setup(currentKey = "agent:ledger:t1") {
  const request = vi.fn(async (method: string) => (method === "contacts.topics" ? { topics } : {}));
  const session = { request, onGatewayEvent: () => () => undefined, engine: { request } } as unknown as SaplingSession;
  const list = { refresh: vi.fn(async () => undefined) } as unknown as ConversationList;
  const onOpen = vi.fn();
  function Host() {
    const t = useR1Topics({ session, ready: true, rows, list, currentKey, mainSuffix: "main", onOpen });
    return <><section data-testid="column">{t.column}</section><section data-testid="above">{t.above}</section></>;
  }
  return { request, onOpen, Host };
}
const flush = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const column = () => document.querySelector<HTMLElement>('[data-testid="column"]')!;
const above = () => document.querySelector<HTMLElement>('[data-testid="above"]')!;

it("finds the Trunk whose threads show from its own conversation or one of its threads", () => {
  expect(topicContactFor(rows, "agent:ledger:main")).toEqual({ id: "trunk:ledger", key: "agent:ledger:main", name: "Ledger" });
  expect(topicContactFor(rows, "agent:ledger:t2")).toEqual({ id: "trunk:ledger", key: "agent:ledger:main", name: "Ledger" });
  expect(topicContactFor(rows, "agent:nobody:main")).toBeNull();
  expect(topicContactFor([...rows, conv("agent:ledger:other", { parentKey: "agent:scout:main" })], "agent:ledger:other")).toBeNull();
});

it("draws the Classic thread rail in the topics column on clear glass for Freedom Mode, with General and each thread", async () => {
  localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "free", width: 300, per: {} }));
  const { Host, request } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(request).toHaveBeenCalledWith("contacts.topics", { contactId: "trunk:ledger", limit: 200 });
  const rail = column().querySelector(".r1-topic-host")!;
  expect(rail.classList).toContain("g-clear");
  expect(rail.querySelector('nav[aria-label="Threads"]')).not.toBeNull();
  expect(rail.textContent).toContain("General");
  expect(rail.textContent).toContain("Card charges");
  expect(above().childElementCount).toBe(0);
});

it("renames a thread through sessions.patch from its More menu, in a clear dialog", async () => {
  const { Host, request } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  await act(async () => column().querySelector<HTMLButtonElement>('[aria-label="More for Card charges"]')!.click());
  const rename = [...column().querySelectorAll<HTMLButtonElement>(".pop button")].find((b) => b.textContent?.startsWith("Rename"))!;
  await act(async () => rename.click());
  const dialog = column().querySelector<HTMLElement>('[role="dialog"][aria-label="Rename thread"]')!;
  expect(dialog.classList).toContain("g-clear");
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Card fees"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { dialog.querySelector<HTMLFormElement>("form")?.requestSubmit(); });
  await flush();
  expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:ledger:t2", agentId: "ledger", expectedSessionId: "s2", label: "Card fees" });
});

it("changes a thread's emoji from its emoji button and keeps the choice", async () => {
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  await act(async () => column().querySelector<HTMLButtonElement>('[aria-label="Change the emoji for Card charges"]')!.click());
  const option = column().querySelector<HTMLButtonElement>('.emoGridT5 [role="option"]')!;
  const chosen = option.textContent!;
  await act(async () => option.click());
  expect(JSON.parse(localStorage.getItem("branch-topic-emoji-t5")!)).toEqual({ "agent:ledger:t2": chosen });
});

it("folds the threads into a Threads · N chip above the chat below 900 px", async () => {
  narrow = true;
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(column().childElementCount).toBe(0);
  const chip = above().querySelector<HTMLButtonElement>(".r1-topic-fold > button")!;
  expect(chip.textContent).toBe("Threads · 3");
  expect(above().querySelector(".r1-topic-host")).toBeNull();
  await act(async () => chip.click());
  expect(chip.getAttribute("aria-expanded")).toBe("true");
  expect(above().querySelector(".r1-topic-host")?.textContent).toContain("Month-end close");
});

it("draws Tabs above the chat by default, and for a saved removed layout (owner item 47)", async () => {
  localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "rail", width: 64, per: { "trunk:ledger": "side" } }));
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(column().childElementCount).toBe(0);
  expect(above().querySelector(".topicsT5.lay-tabs")).not.toBeNull();
});
