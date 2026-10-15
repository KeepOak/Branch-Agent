// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { FIND_EVENT } from "../../thread/FindBar";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => null }));
vi.mock("../../connect/branch-version", async (load) => ({ ...(await load<typeof import("../../connect/branch-version")>()), useBranchVersion: () => "0.4.4" }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.useRealTimers(); });

const contact = (id: string, kind: string, name: string) => ({
  id, kind, name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
});
const row = (key: string, title: string, agentId: string, archived = false) => ({ key, title, agentId, pinned: false, archived, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 10,
  preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, isMain: false });
const RESPONSES: Record<string, unknown> = {
  "contacts.list": { contacts: [contact("trunk:ledger", "trunk", "Ledger"), contact("a2a:cc", "outside", "Claude Code")] },
  "rooms.list": { rooms: [] },
  "a2a.peers.list": { peers: [] },
  "agents.list": { defaultId: "ledger", agents: [{ id: "ledger", identity: { name: "Ledger" } }] },
  "sessions.search": { results: [{ sessionKey: "agent:ledger:quotes", role: "assistant", snippet: "The supplier quote came in at 412 dollars.", timestamp: 5, messageId: "m1" }] },
  "memory.search": { results: [{ path: "memory/quotes.md", snippet: "Quote from Oakfield for paper." }] },
};
const methods = ["contacts.list", "agents.list", "rooms.list", "sessions.search", "memory.search", "sessions.patch", "sessions.create", "chat.send", "chat.history"];

function setup() {
  const request = vi.fn(async (method: string) => RESPONSES[method] ?? {});
  const engine = { request, features: { methods, events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const sessions = [row("agent:ledger:quotes", "Supplier quotes", "ledger"), row("agent:ledger:old-quote", "Old quote run", "ledger", true)];
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: sessions as unknown as SidebarProps["sessions"], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  return { request, props, render: async () => { await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>)); await act(async () => undefined); } };
}
const type = async (value: string) => {
  const input = host.querySelector<HTMLInputElement>(".r1sb-search input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // The Classic search waits 180 ms after the last key before it asks the engine.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
};
const click = async (node: Element | null) => act(async () => { (node as HTMLElement).click(); });
const labels = () => [...host.querySelectorAll(".search-results .lh")].map(node => node.textContent);

describe("R1 sidebar search (the Classic search re-hosted in the capsule)", () => {
  it("replaces the list with the Classic results and asks sessions.search and memory.search", async () => {
    const { render, request } = setup();
    await render();
    expect(host.querySelector('[data-testid="search-results"]')).toBeNull();
    await type("quote");
    expect(host.querySelector('.r1sb-list [data-testid="search-results"]')).not.toBeNull();
    expect(request).toHaveBeenCalledWith("sessions.search", expect.objectContaining({ query: "quote", limit: 25 }));
    expect(request).toHaveBeenCalledWith("memory.search", { query: "quote" });
    expect(labels()).toEqual(["Chats and Trunks", "Messages", "Past sessions", "Files and memory"]);
    expect(host.querySelector(".r1sb-bins")).toBeNull();
    expect([...host.querySelectorAll(".search-results .chip")].map(chip => chip.textContent)).toEqual(["All4", "Chats1", "Messages1", "Past1", "Files1"]);
  });

  it("keeps the sidebar's own contact matches first under Chats and Trunks", async () => {
    const { render } = setup();
    await render();
    await type("claude");
    expect(labels()[0]).toBe("Chats and Trunks");
    expect([...host.querySelectorAll(".search-results .r1sb-name > span")].map(node => node.textContent)).toEqual(["Claude Code"]);
  });

  it("leaves the search when one of the sidebar's own matches is opened", async () => {
    const { render, props } = setup();
    await render();
    await type("ledger");
    await click(host.querySelector('.search-results .r1sb-row[aria-label^="Ledger"]'));
    expect(props.onOpen).toHaveBeenCalledWith("agent:ledger:main");
    expect(host.querySelector<HTMLInputElement>(".r1sb-search input")!.value).toBe("");
    expect(host.querySelector('[data-testid="search-results"]')).toBeNull();
  });

  it("opens a message hit in its conversation and asks find in this conversation for the words", async () => {
    const { render, props } = setup();
    await render();
    await type("quote");
    const asked: (string | undefined)[] = [];
    const listen = (event: Event) => asked.push((event as CustomEvent<{ query?: string }>).detail?.query);
    window.addEventListener(FIND_EVENT, listen);
    const message = [...host.querySelectorAll('.search-results [data-testid="search-result"]')].find(node => node.textContent?.includes("412 dollars"))!;
    await click(message);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    window.removeEventListener(FIND_EVENT, listen);
    expect(props.onOpen).toHaveBeenCalledWith("agent:ledger:quotes");
    expect(asked).toEqual(["quote"]);
    expect(host.querySelector<HTMLInputElement>(".r1sb-search input")!.value).toBe("");
    expect(host.querySelector('[data-testid="search-results"]')).toBeNull();
  });

  it("opens Library for a file hit and filters by chip", async () => {
    const { render, props } = setup();
    await render();
    await type("quote");
    await click(host.querySelector('.search-results .chip[data-chip="files"]'));
    expect(labels()).toEqual(["Files and memory"]);
    await click(host.querySelector('.search-results [data-testid="search-result"]'));
    expect(props.onPlace).toHaveBeenCalledWith("library");
  });
});
