// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { comingControls } from "../../glass/coming-registry";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
const update = vi.hoisted(() => ({ value: null as null | { current: string; latest: string | null; notes: string[]; installing: boolean; waiting: string | null; ready?: boolean } }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => update.value }));
vi.mock("../../connect/branch-version", async (load) => ({ ...(await load<typeof import("../../connect/branch-version")>()), useBranchVersion: () => "0.4.4" }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); update.value = null;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const contact = (id: string, kind: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, kind, name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const FULL = {
  "contacts.list": { contacts: [
    contact("trunk:sapling", "trunk", "Sapling", { isDefault: true, pinnedAt: 1 }),
    contact("trunk:ledger", "trunk", "Ledger", { threadUnread: true }),
    contact("a2a:cc", "outside", "Claude Code"),
  ] },
  "agents.list": { defaultId: "sapling", agents: [{ id: "sapling", identity: { name: "Sapling" } }, { id: "ledger", identity: { name: "Ledger" } }] },
  "rooms.list": { rooms: [{ roomId: "r1", name: "Supplier quotes", lead: "sapling", createdAt: 5, members: [{ kind: "trunk", id: "sapling" }, { kind: "trunk", id: "ledger" }] }] },
  "a2a.peers.list": { peers: [] },
  "users.self": { profile: { id: "me", displayName: "Taofik" } },
  "users.list": { profiles: [{ id: "me", displayName: "Taofik" }, { id: "dana", displayName: "Dana Okafor", role: "member" }] },
};
// Everything the sidebar calls except sessions.restore, which the engine lacks (own folders are Coming in the folder strip).
const methods = ["contacts.list", "agents.list", "rooms.list", "sessions.patch", "sessions.patchMany", "sessions.delete", "sessions.create", "sessions.compact",
  "sessions.groups.list", "contacts.markRead", "contacts.topics", "rooms.create", "rooms.archive", "agents.create", "agents.update", "agents.delete", "chat.send", "chat.history", "branch.chat"];

function setup(responses: Record<string, unknown>, ready = true, over: Partial<SidebarProps> = {}) {
  const request = vi.fn(async (method: string) => responses[method] ?? {});
  const engine = { request, features: { methods, events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(), ...over,
  };
  return { request, props, render: async () => { await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>)); await act(async () => undefined); } };
}
// Menus open in a portal on document.body, so read from the whole document.
const text = (selector: string) => [...document.querySelectorAll(selector)].map(node => node.textContent);
const click = async (node: Element | null) => act(async () => { (node as HTMLElement).click(); });

describe("R1 sidebar", () => {
  it("says why when the conversation list couldn't load", async () => {
    const { render } = setup(FULL, true, { error: "Couldn’t load conversations: gateway timeout" });
    await render();
    const alert = host.querySelector('nav[aria-label="Conversations"] [role="alert"]');
    expect(alert?.textContent).toBe("Couldn’t load conversations: gateway timeout");
  });

  it("renders an empty disconnected engine with no demo data", async () => {
    const { render } = setup({}, false);
    await render();
    // The frame's notice says "Reconnecting…"; the sidebar doesn't repeat it (one status line, and the tour waits on it).
    expect(host.textContent).toContain("Your conversations show here once Branch connects.");
    expect(host.textContent).not.toContain("Reconnecting");
    expect(host.querySelectorAll(".r1sb-row, .r1sb-pin")).toHaveLength(0);
    expect(text(".r1sb-caps > *").length).toBe(4);
    expect(host.querySelector(".r1sb-upd")).toBeNull();
    expect(host.querySelector(".r1sb-seed")?.textContent).toBe("Seedbank");
  });

  it("shows the engine's contacts in Pinned, Trunks, People, Groups and Grafted", async () => {
    const { render } = setup(FULL);
    await render();
    expect(text(".r1sb-head > span")).toEqual(["Pinned", "Trunks", "People", "Groups", "Grafted"]);
    expect(text(".r1sb-pin-name")).toEqual(["Sapling"]);
    expect(text(".r1sb-pin-role")).toEqual(["Chief of Staff"]);
    expect(host.querySelector(".r1sb-pin .g-av-leaf")).not.toBeNull();
    expect(text(".r1sb-name > span")).toEqual(["Ledger", "Dana Okafor", "Supplier quotes", "Claude Code"]);
    expect(host.querySelectorAll(".r1sb-rw [data-slot]")).toHaveLength(2);
    expect(host.querySelector(".r1sb-tag")?.textContent).toBe("Member");
  });

  it("opens a row's conversation, and People in Settings", async () => {
    const { render, props } = setup(FULL);
    await render();
    await click(host.querySelector('.r1sb-row[aria-label^="Ledger"]'));
    expect(props.onOpen).toHaveBeenCalledWith("agent:ledger:main");
    await click(host.querySelector('.r1sb-row[aria-label^="Dana"]'));
    expect(props.onSettings).toHaveBeenCalledWith("people");
    expect(host.querySelector('.r1sb-rw[data-kind="person"] .r1sb-more')).toBeNull();
  });

  it("opens the row ••• menu with four tiles and pins through sessions.patch", async () => {
    const ledger = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", pinned: false, archived: false, unread: true, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 };
    const { render, request } = setup(FULL, true, { sessions: [ledger] as unknown as SidebarProps["sessions"] });
    await render();
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    expect(text(".g-menu-tile-label")).toEqual(["Pin", "Read", "Snooze ›", "Archive"]);
    expect(text(".g-menu-row .g-menu-label")).toContain("Delete conversation…");
    await click(document.querySelector(".g-menu-tile"));
    expect(request).toHaveBeenCalledWith("sessions.patch", expect.objectContaining({ key: "agent:ledger:main", pinned: true }));
  });

  it("folds the folders into one chip and filters by the one picked", async () => {
    const { render } = setup(FULL);
    await render();
    const fold = host.querySelector(".r1sb-fold")!;
    expect(fold.hasAttribute("data-open")).toBe(false);
    await click(fold.querySelector(".r1sb-chip"));
    expect(fold.hasAttribute("data-open")).toBe(true);
    await click([...fold.querySelectorAll(".r1sb-chip")].find(chip => chip.textContent?.startsWith("Groups"))!);
    expect(text(".r1sb-name > span")).toEqual(["Supplier quotes"]);
  });

  it("searches names and previews, and hides the folder chip while searching", async () => {
    const { render, props } = setup(FULL);
    await render();
    const input = host.querySelector<HTMLInputElement>(".r1sb-search input")!;
    expect(props.searchRef.current).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "claude");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text(".r1sb-name > span")).toEqual(["Claude Code"]);
    expect(host.querySelector(".r1sb-fold")).toBeNull();
  });

  it("opens Recently deleted to a Nothing here state, marks New folder Coming (preview foldP11), and opens Seedbank, Grove and Settings", async () => {
    const { render, props } = setup(FULL);
    await render();
    const deleted = [...host.querySelectorAll<HTMLButtonElement>(".r1sb-bins .r1sb-bin")].find(bin => bin.textContent?.includes("Recently deleted"))!;
    expect(deleted.getAttribute("aria-disabled")).toBeNull();
    expect(deleted.getAttribute("aria-expanded")).toBe("false");
    await click(deleted);
    expect(deleted.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".r1sb-bins")!.textContent).toContain("Nothing here");
    // #1049: the preview's folder strip ends in a "New folder" chip; it is Coming here, never moved off to Seedbank.
    const add = host.querySelector(".r1sb-fold")!.querySelector('[aria-label="New folder"]')!;
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(add.getAttribute("title")).toBe("Your own folders come in a later update.");
    expect(comingControls().find(entry => entry.need.includes("sessions.folders.put"))?.where).toBe("Sidebar › New folder");
    await click(host.querySelector(".r1sb-seed"));
    expect(props.onPlace).toHaveBeenCalledWith("seedbank");
    await click(host.querySelector('[aria-label="Grove"]'));
    expect(props.onPlace).toHaveBeenCalledWith("office");
    await click(host.querySelector('.r1sb-caps [aria-label="Settings"]'));
    expect(props.onSettings).toHaveBeenCalledWith("general");
  });

  it("shows the update button only when an update exists, and the + menu", async () => {
    update.value = { current: "0.4.4", latest: "0.5.0", notes: [], installing: false, waiting: null };
    const { render, props } = setup(FULL);
    await render();
    expect(host.querySelector(".r1sb-upd")?.getAttribute("aria-label")).toBe("Update to 0.5.0");
    await click(host.querySelector(".r1sb-upd"));
    expect(props.onSettings).toHaveBeenCalledWith("updates");
    await click(host.querySelector('[aria-label="New, places and more"]'));
    expect(text(".g-menu-row .g-menu-label")).toEqual(["New conversation", "New Trunk", "New group", "Have Branch make a Trunk", "New automation", "Quick ask", "Collapse the list to faces"]);
    expect(text(".g-menu-row .g-menu-end small")).toEqual(["random character", "Ctrl Shift Space", "Ctrl B"]);
  });

  it("shows a downloaded update as a calm ready chip, never as installing", async () => {
    update.value = { current: "0.4.4", latest: "0.5.0", notes: [], installing: false, ready: true, waiting: "Update ready. It applies when no Trunk is working" };
    const { render } = setup(FULL);
    await render();
    const chip = host.querySelector(".r1sb-upd");
    expect(chip?.getAttribute("aria-label")).toBe("Update ready, 0.5.0");
    expect(chip?.hasAttribute("data-busy")).toBe(false);
    expect(chip?.getAttribute("title")).toBe("Update ready. It applies when no Trunk is working");
  });

  it("opens the person menu with the update banner on top and no Settings row", async () => {
    update.value = { current: "0.4.4", latest: "0.5.0", notes: [], installing: false, waiting: null };
    const { render } = setup(FULL);
    await render();
    await click(host.querySelector(".r1sb-me"));
    const menu = document.querySelector(".r1sb-person")!;
    expect(menu.firstElementChild?.textContent).toContain("Update to 0.5.0");
    expect(menu.textContent).toContain("Who is using Branch");
    expect(text(".r1sb-person .g-menu-row .g-menu-label")).toEqual(["Keyboard shortcuts", "Get the apps", "Guide", "About Branch", "Lock Branch"]);
  });

  it("opens its menus as clear glass with frosted pills (item 48): the + and person menus sit in .r1sb-pop", async () => {
    const { render } = setup(FULL);
    await render();
    await click(host.querySelector('[aria-label="New, places and more"]'));
    expect(document.querySelector(".g-popover > .r1sb-pop .g-menu")).not.toBeNull();
    await click(host.querySelector(".r1sb-me"));
    expect(document.querySelector(".g-popover > .r1sb-pop.r1sb-person")).not.toBeNull();
    const css = readFileSync("src/screens/sidebar/sidebar.css", "utf8").replace(/\s+/g, " ");
    expect(css).toContain(".g-popover:has(> .r1sb-pop) { background: transparent; backdrop-filter: none;");
    expect(css).toMatch(/\.r1sb-pop :is\(\.g-menu-row, \.g-menu-tile[^{]*\{ background: var\(--gp-fill\); backdrop-filter: var\(--gp-blur\);[^}]*box-shadow: inset 0 0 0 1px var\(--gp-edge\);/);
    expect(readFileSync("src/theme/tokens.css", "utf8")).toContain("--gp-fill: rgba(255,255,255,.76); --gp-edge: rgba(0,0,0,.11);");
  });
});
