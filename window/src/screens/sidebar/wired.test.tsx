// @vitest-environment jsdom
// Card #977, wire now: Have Branch make a Trunk (branch.chat), Move to › Group… (sessions.groups.list + sessions.patch),
// and Unarchive a group (rooms.archive with archived: false) call the engine once it offers the method, and are Coming
// (nothing undeclared, nothing sent) on an engine without it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const contact = (id: string, kind: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, kind, name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const DATA: Record<string, unknown> = {
  "contacts.list": { contacts: [contact("trunk:sapling", "trunk", "Sapling", { isDefault: true }), contact("trunk:ledger", "trunk", "Ledger")] },
  "agents.list": { defaultId: "sapling", agents: [{ id: "sapling", identity: { name: "Sapling" } }, { id: "ledger", identity: { name: "Ledger" } }] },
  "rooms.list": { rooms: [{ roomId: "r1", name: "Supplier quotes", lead: "sapling", createdAt: 5, archivedAt: 6, members: [{ kind: "trunk", id: "sapling" }, { kind: "trunk", id: "ledger" }] }] },
  "a2a.peers.list": { peers: [] },
  "users.self": { profile: { id: "me", displayName: "Taofik" } },
  "users.list": { profiles: [{ id: "me", displayName: "Taofik" }] },
  "sessions.groups.list": { groups: [{ name: "Finance", position: 0 }] },
  "branch.chat": { reply: "A Trunk called Ledger 2 that watches renewals. Make it?", needsApproval: true },
};
const ledger = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 };
const WIRED = ["branch.chat", "sessions.groups.list", "sessions.patch", "rooms.archive"];

async function render(methods: string[]) {
  const request = vi.fn(async (method: string) => DATA[method] ?? {});
  const engine = { request, scopes: ["operator.admin"], features: { methods, events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [ledger] as unknown as SidebarProps["sessions"], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
  return { request };
}
const click = async (node: Element | null) => act(async () => { (node as HTMLElement).click(); });
const closeMenus = async () => { for (let i = 0; i < 4 && document.querySelector(".g-menu"); i++) await act(async () => void document.querySelector(".g-menu")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); };
const type = async (node: Element | null, value: string) => act(async () => {
  const field = node as HTMLInputElement | HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const row = (label: string) => [...document.querySelectorAll<HTMLElement>(".g-menu-row, .g-menu-tile")].find(item => item.querySelector(".g-menu-label, .g-menu-tile-label")?.firstChild?.textContent?.startsWith(label))!;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
const undeclared = () => undeclaredControls(document).map(element => element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName);
const coming = (where: string) => comingControls().find(entry => entry.where === where);
const openArchivedRoomMenu = async () => {
  await click([...host.querySelectorAll(".r1sb-bins .r1sb-bin")].find(bin => bin.textContent?.includes("Archived"))!);
  await click(host.querySelector('[aria-label="More for Supplier quotes"]'));
};

describe("R1 sidebar, the wired-now entries (#977)", () => {
  it("+ › Quick ask opens the R1 Quick ask box (branch:quick-ask), and is Coming without sessions.create", async () => {
    const heard = vi.fn();
    window.addEventListener("branch:quick-ask", heard);
    await render([...WIRED, "sessions.create", "chat.send"]);
    await click(host.querySelector('[aria-label="New, places and more"]'));
    expect(row("Quick ask").getAttribute("aria-disabled")).toBeNull();
    expect(row("Quick ask").dataset.need).toBe("sessions.create chat.send");
    await click(row("Quick ask"));
    expect(heard).toHaveBeenCalledOnce();
    await closeMenus();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(WIRED);
    await click(host.querySelector('[aria-label="New, places and more"]'));
    expect(undeclared()).toEqual([]);
    expect(row("Quick ask").getAttribute("aria-disabled")).toBe("true");
    expect(coming("Quick ask")?.need).toEqual(["sessions.create", "chat.send"]);
    await click(row("Quick ask"));
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener("branch:quick-ask", heard);
  });

  it("has Branch make a Trunk through branch.chat's new-agent welcome", async () => {
    const { request } = await render(WIRED);
    await click(host.querySelector('[aria-label="New, places and more"]'));
    const entry = row("Have Branch make a Trunk");
    expect(entry.getAttribute("aria-disabled")).toBeNull();
    expect(entry.textContent).not.toContain("later update");
    await click(entry);
    const studio = document.querySelector('[data-testid="trunk-studio"]')!;
    expect(studio).not.toBeNull();
    await type(studio.querySelector("textarea"), "Watch my subscriptions");
    await click(button("Propose it"));
    expect(request).toHaveBeenCalledWith("branch.chat", expect.objectContaining({ welcomeVariant: "new-agent", message: "Make me a Trunk: Watch my subscriptions" }));
    expect(studio.textContent).toContain("Make it?");
  });

  it("moves a conversation into a group with sessions.patch's category, offering the groups from sessions.groups.list", async () => {
    const { request } = await render(WIRED);
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    const entry = row("Move to group…");
    expect(entry.getAttribute("aria-disabled")).toBeNull();
    expect(entry.dataset.need).toBe("sessions.groups.list sessions.patch");
    await click(entry);
    expect(request).toHaveBeenCalledWith("sessions.groups.list", {});
    const dialog = document.querySelector('[data-testid="move-group"]')!;
    await click(button("Finance"));
    await click(button("Move"));
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:ledger:main", category: "Finance" });
    request.mockClear();
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    await click(row("Move to group…"));
    await type(document.querySelector('[aria-label="Group name"]'), "Taxes 2026");
    await click(button("Move"));
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:ledger:main", category: "Taxes 2026" });
    expect(dialog.isConnected).toBe(false);
  });

  it("unarchives an archived group through rooms.archive with archived false", async () => {
    const { request } = await render(WIRED);
    await openArchivedRoomMenu();
    const tile = row("Unarchive");
    expect(tile.getAttribute("aria-disabled")).toBeNull();
    expect(tile.dataset.need).toBe("rooms.archive");
    await click(tile);
    expect(request).toHaveBeenCalledWith("rooms.archive", { roomId: "r1", archived: false });
    expect(request).toHaveBeenCalledWith("rooms.list", { includeArchived: true });
  });

  it("keeps all three Coming, with their methods, on an engine without them", async () => {
    const { request } = await render([]);
    request.mockClear();
    await click(host.querySelector('[aria-label="New, places and more"]'));
    expect(undeclared()).toEqual([]);
    expect(row("Have Branch make a Trunk").getAttribute("aria-disabled")).toBe("true");
    expect(coming("Have Branch make a Trunk")?.need).toEqual(["branch.chat"]);
    await click(row("Have Branch make a Trunk"));
    expect(document.querySelector('[data-testid="trunk-studio"]')).toBeNull();
    await closeMenus();

    await click(host.querySelector('[aria-label="More for Ledger"]'));
    expect(undeclared()).toEqual([]);
    expect(row("Move to group…").getAttribute("aria-disabled")).toBe("true");
    expect(coming("Move to group…")?.need).toEqual(["sessions.groups.list", "sessions.patch"]);
    await click(row("Move to group…"));
    expect(document.querySelector('[data-testid="move-group"]')).toBeNull();
    await closeMenus();

    await openArchivedRoomMenu();
    expect(undeclared()).toEqual([]);
    expect(row("Unarchive").getAttribute("aria-disabled")).toBe("true");
    expect(coming("Unarchive")?.need).toEqual(["rooms.archive"]);
    await click(row("Unarchive"));
    expect(request.mock.calls.map(([method]) => method).filter(method => !method.endsWith(".list") && method !== "users.self")).toEqual([]);
  });
});
