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
  localStorage.clear(); narrow = false;
  vi.stubGlobal("matchMedia", () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function setup(currentKey = "agent:ledger:t1") {
  const request = vi.fn(async (method: string) => (method === "contacts.topics" ? { topics } : method === "sessions.create" ? { key: "agent:ledger:t3" } : {}));
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

it("names the Trunk by the name the window shows, never its id", () => {
  const untitled = [conv("agent:juniper:main", { agentId: "juniper", title: "" }), conv("agent:juniper:t1", { agentId: "juniper", parentKey: "agent:juniper:main" })];
  expect(topicContactFor(untitled, "agent:juniper:t1", "main", "Juniper")?.name).toBe("Juniper");
  expect(topicContactFor(untitled, "agent:juniper:t1")?.name).toBe("juniper");
});

it("draws the threads above the chat as Tabs by default, on clear glass, with General and each thread", async () => {
  const { Host, request } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(request).toHaveBeenCalledWith("contacts.topics", { contactId: "trunk:ledger", limit: 200 });
  expect(column().childElementCount).toBe(0);
  const rail = above().querySelector(".r1-topic-host")!;
  expect(rail.classList).toContain("g-clear");
  expect(rail.querySelector(".topicsT5.lay-tabs")).not.toBeNull();
  expect(rail.textContent).toContain("General");
  expect(rail.textContent).toContain("Card charges");
});

it("reads a saved removed layout as Tabs above the chat, even at a narrow width", async () => {
  narrow = true;
  localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "column", width: 300, per: { "trunk:ledger": "side" } }));
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(column().childElementCount).toBe(0);
  expect(above().querySelector(".topicsT5.lay-tabs")).not.toBeNull();
  expect(above().querySelector(".r1-topic-fold")).toBeNull();
});

it("renames a thread from its tab's right-click menu through sessions.patch, in a clear dialog", async () => {
  const { Host, request } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  const tab = above().querySelector<HTMLButtonElement>('[aria-label="Card charges"]')!;
  await act(async () => tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })));
  const rename = [...document.querySelectorAll<HTMLButtonElement>(".pop button")].find((b) => b.textContent?.startsWith("Rename"))!;
  await act(async () => rename.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Rename thread"]')!;
  expect(dialog.classList).toContain("g-clear");
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Card fees"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { dialog.querySelector<HTMLFormElement>("form")?.requestSubmit(); });
  await flush();
  expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:ledger:t2", agentId: "ledger", expectedSessionId: "s2", label: "Card fees" });
});

it("changes a thread's icon from its tab's menu and keeps the choice", async () => {
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  const tab = above().querySelector<HTMLButtonElement>('[aria-label="Card charges"]')!;
  await act(async () => tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })));
  const change = [...document.querySelectorAll<HTMLButtonElement>(".pop button")].find((b) => b.textContent?.startsWith("Change icon"))!;
  await act(async () => change.click());
  const option = document.querySelector<HTMLButtonElement>('.emoGridT5 [role="option"]')!;
  const chosen = option.textContent!;
  await act(async () => option.click());
  expect(JSON.parse(localStorage.getItem("branch-topic-emoji-t5")!)).toEqual({ "agent:ledger:t2": chosen });
});

it("draws Freedom Mode as the threads column beside the chat, with the + in its header", async () => {
  localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "free", width: 0, per: {} }));
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(above().childElementCount).toBe(0);
  const rail = column().querySelector(".r1-topic-host")!;
  expect(rail.querySelector(".topicsT5.lay-column")).not.toBeNull();
  expect(rail.querySelector(".tpResT5")).toBeNull();
  expect(rail.querySelector(".tpHeadT5 > .tpAddP17")).not.toBeNull();
  expect(rail.textContent).toContain("Card charges");
});

it("creates a topic from the + under the Trunk's main conversation, then opens it", async () => {
  const { Host, request, onOpen } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  await act(async () => above().querySelector<HTMLButtonElement>('.tpTabsT5 > .tpAddP17')!.click());
  const name = document.querySelector<HTMLInputElement>('input[placeholder="What is it about?"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Ski weekend"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  const create = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Create")!;
  await act(async () => create.click());
  await flush();
  expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "ledger", parentSessionKey: "agent:ledger:main", label: "Ski weekend", displayName: "Ski weekend" });
  expect(onOpen).toHaveBeenCalledWith("agent:ledger:t3");
});

it("draws Tabs above the chat when that is the chosen layout", async () => {
  localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "tabs", width: 0, per: {} }));
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await flush();
  expect(column().childElementCount).toBe(0);
  expect(above().querySelector(".topicsT5.lay-tabs")).not.toBeNull();
});
