// @vitest-environment jsdom
// GOD queue item 4, right-click menus: a Trunk row and a pinned face in the R1 sidebar open the preview's row menu
// (preview P17 r3 items 19 + 20, `.pinTileT5` › rowmorePA18) from right-click, the hover •••, Shift+F10 and the Menu
// key. A pinned face adds Replace with a different Trunk…, which swaps the pin. Each entry runs the Classic action
// against a mock engine; closing the menu puts focus back on the row.
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
vi.mock("../../shell/own-window", async (load) => ({ ...(await load<typeof import("../../shell/own-window")>()), ownWindowUnavailable: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const writeText = vi.fn(async () => undefined);
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  writeText.mockClear();
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const PIN_KEY = "ui.window.contactPinOrder";
const contact = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "trunk", name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const session = (agentId: string, title: string, pinned = false) => ({ key: `agent:${agentId}:main`, title, agentId, pinned, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 });
const DATA: Record<string, unknown> = {
  "contacts.list": { contacts: [contact("trunk:sapling", "Sapling", { isDefault: true, pinnedAt: 1 }), contact("trunk:ledger", "Ledger", { pinnedAt: 5 }), contact("trunk:scout", "Scout"), contact("trunk:quill", "Quill")] },
  "agents.list": { defaultId: "sapling", agents: ["sapling", "ledger", "scout", "quill"].map(id => ({ id, identity: { name: id } })) },
  "rooms.list": { rooms: [] }, "a2a.peers.list": { peers: [] },
  "users.self": { profile: { id: "me", displayName: "Taofik" } }, "users.list": { profiles: [] },
  "users.prefs.get": { status: "ok", entries: { [PIN_KEY]: ["agent:ledger:main"] } },
  "users.prefs.set": { status: "ok" },
  "contacts.topics": { topics: [] },
};
const ALL = [...Object.keys(DATA), "sessions.patch", "sessions.patchMany", "sessions.delete", "sessions.create", "contacts.markRead", "chat.history", "chat.send", "sessions.groups.list", "agents.update", "agents.delete", "sessions.compact"];

async function render(methods = ALL) {
  const request = vi.fn(async (method: string) => DATA[method] ?? {});
  const engine = { request, scopes: ["operator.admin"], features: { methods, events: [] } };
  const live = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session: live, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [session("sapling", "Sapling", true), session("ledger", "Ledger", true), session("scout", "Scout")] as unknown as SidebarProps["sessions"],
    mainKey: "agent:sapling:main", currentKey: null, waiting: new Map(), searchRef: { current: null }, onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
  await act(async () => undefined);
  return { request, onPlace: props.onPlace, onOpen: props.onOpen };
}
const click = async (node: Element | null) => act(async () => { (node as HTMLElement).click(); });
const key = async (node: Element | null, init: KeyboardEventInit) => act(async () => { (node as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const entry = (label: string) => [...document.querySelectorAll<HTMLElement>(".g-menu-row, .g-menu-tile")].find(item => item.querySelector(".g-menu-label, .g-menu-tile-label")?.firstChild?.textContent === label)!;
const tileLabels = () => [...document.querySelectorAll(".g-menu-tile .g-menu-tile-label")].map(label => label.textContent);
const rowLabels = () => [...document.querySelectorAll(".g-menu-row .g-menu-label")].map(label => label.firstChild?.textContent);
const scoutRow = () => [...host.querySelectorAll<HTMLButtonElement>(".r1sb-row")].find(row => row.title === "Scout")!;
const ledgerFace = () => host.querySelector<HTMLButtonElement>('.r1sb-pins [data-pin="agent:ledger:main"] .r1sb-pin-open')!;
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([name]) => name === method).map(([, params]) => params);

describe("R1 sidebar right-click menus", () => {
  it.each(["regular", "advanced"] as const)("hides unfinished Coming lines from the Trunk ••• menu at %s (#1874)", async (level) => {
    localStorage.setItem("branch.level", level);
    await render();
    await click(host.querySelector('[aria-label="More for Scout"]'));
    const menu = document.querySelector(".g-menu")!;
    expect(menu.textContent).not.toMatch(/later update|coming/i);
    for (const label of ["Hide from Involving me", "Open folder in", "Assign to…", "Icon and colour", "Archive", "Pause"]) {
      expect(rowLabels(), label).not.toContain(label);
    }
    await click(entry("Copy"));
    expect(document.querySelector(".g-menu")!.textContent).not.toMatch(/later update|coming/i);
  });

  it("opens the preview's row menu on a Trunk row, exactly these items in this order", async () => {
    await render();
    await act(async () => { scoutRow().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(tileLabels()).toEqual([]);
    expect(rowLabels()).toEqual(["Open", "Mark as unread", "Pin to top", "Move to group…", "Rename", "Open in its own window", "Copy into a new conversation", "Copy", "Snooze", "Mark done", "Move to project", "Tidy up…", "New conversation with Scout", "What can Scout do?", "Edit Trunk…", "Delete…", "Remove…"]);
    await click(entry("Copy"));
    expect(rowLabels()).toEqual(["Copy", "Link to this conversation", "Conversation as Markdown", "Conversation ID"]);
    expect(undeclaredControls(document)).toEqual([]);
  });

  it("opens the same menu on a pinned face, with Unpin and Replace with a different Trunk…", async () => {
    await render();
    await act(async () => { ledgerFace().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(tileLabels()).toEqual([]);
    expect(rowLabels()).toEqual(["Open", "Mark as unread", "Unpin", "Move to group…", "Rename", "Open in its own window", "Copy into a new conversation", "Copy", "Snooze", "Mark done", "Move to project", "Tidy up…", "New conversation with Ledger", "What can Ledger do?", "Edit Trunk…", "Replace with a different Trunk…", "Delete…", "Remove…"]);
  });

  it("runs the existing actions: Pin, Unread, Copy › Conversation ID and Rename", async () => {
    const { request, onPlace } = await render();
    await click(host.querySelector('[aria-label="More for Scout"]'));
    await click(entry("Pin to top"));
    expect(calls(request, "sessions.patch")).toContainEqual({ key: "agent:scout:main", agentId: "scout", pinned: true, snoozedUntil: null });
    await click(host.querySelector('[aria-label="More for Scout"]'));
    await click(entry("Mark as unread"));
    expect(calls(request, "sessions.patch")).toContainEqual({ key: "agent:scout:main", agentId: "scout", unread: true });
    await click(host.querySelector('[aria-label="More for Scout"]'));
    await click(entry("Copy"));
    await click(entry("Conversation ID"));
    expect(writeText).toHaveBeenCalledWith("agent:scout:main");
    await click(host.querySelector('[aria-label="More for Scout"]'));
    // A Trunk's Rename is a name box over the list (the name lives on the Trunk): never a trip to People (walkthrough B-093, B-094).
    const opened = vi.fn();
    window.addEventListener("branch:open-trunk", opened);
    await click(entry("Rename"));
    window.removeEventListener("branch:open-trunk", opened);
    expect(onPlace).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    const name = document.querySelector<HTMLInputElement>('[data-testid="rename"] input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(name, "Scouty"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    await click([...document.querySelectorAll<HTMLButtonElement>('[data-testid="rename"] button')].find(button => button.textContent === "Rename")!);
    expect(calls(request, "agents.update")).toEqual([{ agentId: "scout", name: "Scouty" }]);
    expect(document.querySelector('[data-testid="rename"]')).toBeNull();
  });

  it("New conversation with a Trunk makes a new, empty thread under it and opens it (walkthrough B-091)", async () => {
    const { request, onOpen } = await render();
    request.mockImplementation(async (method: string) => method === "sessions.create" ? { key: "agent:scout:dashboard:4f1c" } : DATA[method] ?? {});
    await click(host.querySelector('[aria-label="More for Scout"]'));
    await click(entry("New conversation with Scout"));
    await act(async () => undefined);
    expect(calls(request, "sessions.create")).toEqual([{ agentId: "scout", parentSessionKey: "agent:scout:main" }]);
    expect(onOpen).toHaveBeenCalledWith("agent:scout:dashboard:4f1c");
  });

  it("asks before Delete conversation… deletes, and deletes only on yes", async () => {
    const { request } = await render();
    await click(host.querySelector('[aria-label="More for Scout"]'));
    await click(entry("Delete…"));
    expect(document.querySelector('[data-testid="confirm-delete"]')).not.toBeNull();
    expect(calls(request, "sessions.delete")).toEqual([]);
    await click(document.querySelector('[data-testid="confirm-delete-yes"]'));
    expect(calls(request, "sessions.delete")).toEqual([{ key: "agent:scout:main", agentId: "scout", deleteTranscript: true }]);
  });

  it("replaces a pinned face with a picked Trunk: pins it in the same place, then unpins the old one", async () => {
    const { request } = await render();
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    await click(entry("Replace with a different Trunk…"));
    const picker = document.querySelector('[data-testid="replace-pin"]')!;
    const picks = [...picker.querySelectorAll<HTMLButtonElement>(".r1sb-swap-pick")];
    expect(picks.map(pick => pick.querySelector(".r1sb-swap-name")?.firstChild?.textContent)).toEqual(["Scout", "Quill"]);
    expect(picks[1].disabled).toBe(true);
    expect(picks[1].textContent).toContain("Send a first message first.");
    request.mockClear();
    await click(picks[0]);
    await act(async () => undefined);
    const order = request.mock.calls.map(([method]) => method).filter(method => ["sessions.patch", "users.prefs.set", "sessions.patchMany"].includes(method));
    expect(order).toEqual(["sessions.patch", "users.prefs.set", "sessions.patchMany"]);
    expect(calls(request, "sessions.patch")).toEqual([{ key: "agent:scout:main", agentId: "scout", pinned: true, snoozedUntil: null }]);
    expect(calls(request, "users.prefs.set")).toEqual([{ entries: { [PIN_KEY]: ["agent:scout:main", "agent:ledger:main"] } }]);
    expect(calls(request, "sessions.patchMany")).toEqual([{ targets: [{ key: "agent:ledger:main", agentId: "ledger" }], patch: { pinned: false } }]);
    expect(document.querySelector('[data-testid="replace-pin"]')).toBeNull();
  });

  it("shows Replace as Coming on an engine without the pin calls, and sends nothing", async () => {
    const { request } = await render(Object.keys(DATA));
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    const replace = entry("Replace with a different Trunk…");
    expect(replace.getAttribute("aria-disabled")).toBe("true");
    expect(comingControls().find(control => control.where === "Replace with a different Trunk…")?.need).toEqual(["sessions.patch", "sessions.patchMany", "contacts.topics"]);
    await click(replace);
    expect(document.querySelector('[data-testid="replace-pin"]')).toBeNull();
    expect(undeclaredControls(document)).toEqual([]);
    expect(calls(request, "sessions.patch")).toEqual([]);
  });

  it("opens from the Menu key on a row and Shift+F10 on a pinned face; arrows move, Escape closes, focus returns to the row", async () => {
    await render();
    const row = scoutRow();
    row.focus();
    await key(row, { key: "ContextMenu" });
    expect(document.querySelector(".g-menu")?.getAttribute("aria-label")).toBe("Scout");
    const first = document.activeElement;
    expect(first?.closest(".g-menu")).not.toBeNull();
    await key(first, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.closest(".g-menu")).not.toBeNull();
    await key(document.activeElement, { key: "Escape" });
    expect(document.querySelector(".g-menu")).toBeNull();
    expect(document.activeElement).toBe(row);

    const face = ledgerFace();
    face.focus();
    await key(face, { key: "F10", shiftKey: true });
    expect(document.querySelector(".g-menu")?.getAttribute("aria-label")).toBe("Ledger");
    expect(rowLabels()).toContain("Replace with a different Trunk…");
    await key(document.activeElement, { key: "Escape" });
    expect(document.querySelector(".g-menu")).toBeNull();
    expect(document.activeElement).toBe(face);
  });
});
