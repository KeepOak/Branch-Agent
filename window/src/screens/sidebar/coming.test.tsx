// @vitest-environment jsdom
// R1-10 for the sidebar: against an engine with no methods, every control either names its engine call (and is Coming)
// or says it is local; the dev check finds nothing undeclared, in the list and in every menu, and nothing runs.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => ({ current: "0.4.4", latest: "0.5.0", notes: [], installing: false, waiting: null }) }));
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
  "contacts.list": { contacts: [contact("trunk:sapling", "trunk", "Sapling", { isDefault: true, pinnedAt: 1 }), contact("trunk:ledger", "trunk", "Ledger", { threadUnread: true }), contact("a2a:cc", "outside", "Claude Code")] },
  "agents.list": { defaultId: "sapling", agents: [{ id: "sapling", identity: { name: "Sapling" } }, { id: "ledger", identity: { name: "Ledger" } }] },
  "rooms.list": { rooms: [{ roomId: "r1", name: "Supplier quotes", lead: "sapling", createdAt: 5, members: [{ kind: "trunk", id: "sapling" }, { kind: "trunk", id: "ledger" }] }] },
  "a2a.peers.list": { peers: [] },
  "users.self": { profile: { id: "me", displayName: "Taofik" } },
  "users.list": { profiles: [{ id: "me", displayName: "Taofik" }, { id: "dana", displayName: "Dana Okafor", role: "member" }] },
};
const ledger = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", pinned: false, archived: false, unread: true, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 };

async function render(methods: string[], extra: Partial<SidebarProps> = {}) {
  // The reads still answer (a test engine), but the hello lists only `methods`.
  const request = vi.fn(async (method: string) => DATA[method] ?? {});
  const engine = { request, features: { methods, events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [ledger] as unknown as SidebarProps["sessions"], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(), ...extra,
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
  request.mockClear();
  return { request, props };
}
const click = async (node: Element | null) => act(async () => { (node as HTMLElement).click(); });
const press = async (node: Element, key: string) => act(async () => void node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const undeclared = () => undeclaredControls(document).map(element => element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName);
const row = (label: string) => [...document.querySelectorAll<HTMLElement>(".g-menu-row, .g-menu-tile")].find(item => item.querySelector(".g-menu-label, .g-menu-tile-label")?.firstChild?.textContent?.startsWith(label))!;
const needs = () => comingControls().flatMap(entry => entry.need);

describe("R1 sidebar, the Coming contract", () => {
  it("declares every control in the list, the row menu, the + menu and the person menu against an engine with no methods", async () => {
    const { request } = await render([]);
    expect(undeclared()).toEqual([]);
    expect(host.querySelector(".r1sb-mar")?.getAttribute("aria-disabled")).toBe("true");

    await click(host.querySelector('[aria-label="More for Ledger"]'));
    expect(undeclared()).toEqual([]);
    for (const label of ["Pin", "Read", "Archive", "Delete conversation…"]) expect(row(label).getAttribute("aria-disabled"), label).toBe("true");
    await click(row("Pin"));
    await press(document.querySelector(".g-menu")!, "p");
    await press(document.querySelector(".g-menu")!, "d");
    expect(request).not.toHaveBeenCalled();
    expect(needs()).toEqual(expect.arrayContaining(["sessions.patch", "contacts.markRead", "sessions.delete"]));
    await click(row("Ledger"));
    expect(undeclared()).toEqual([]);
    expect(row("Pause").title).toBe("Pausing a Trunk needs an engine method it doesn't have yet.");
    expect(needs()).toEqual(expect.arrayContaining(["chat.send", "agents.update", "agents.delete"]));
    await press(document.querySelector(".g-menu")!, "Escape");

    await click(host.querySelector('[aria-label="New, places and more"]'));
    expect(undeclared()).toEqual([]);
    expect(row("New Trunk").getAttribute("aria-disabled")).toBe("true");
    expect(row("New group").getAttribute("aria-disabled")).toBe("true");
    expect(needs()).toEqual(expect.arrayContaining(["agents.create", "rooms.create"]));
    await click(row("New conversation"));
    expect(row("with Sapling").getAttribute("aria-disabled")).toBe("true");
    expect(needs()).toContain("sessions.create");

    await click(host.querySelector(".r1sb-me"));
    expect(undeclared()).toEqual([]);
    await click(row("Guide"));
    expect(undeclared()).toEqual([]);
    // Without the greyed-with-a-reason exemption too: every Guide row says local (the walkthrough is the window's own tour).
    const guide = [...document.querySelectorAll<HTMLElement>(".g-menu-row:not(.g-menu-back)")];
    expect(guide.length).toBeGreaterThan(1);
    expect(guide.filter(item => !item.closest("[data-local], [data-need], [data-coming]")).map(item => item.textContent)).toEqual([]);
    expect(row("Walkthrough").hasAttribute("data-local")).toBe(true);
    expect(row("Walkthrough").getAttribute("aria-disabled")).toBe("true");
    expect(request).not.toHaveBeenCalled();
  });

  it("runs the same entries once the engine offers the calls, and keeps the unwired ones Coming with their method", async () => {
    const { request } = await render(["sessions.patch", "sessions.patchMany", "contacts.topics", "contacts.markRead", "sessions.create", "sessions.delete", "rooms.archive", "rooms.create", "agents.create", "agents.update", "agents.delete", "chat.send", "chat.history", "sessions.compact", "sessions.groups.list"]);
    expect(host.querySelector(".r1sb-mar")?.getAttribute("aria-disabled")).toBeNull();
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    expect(row("Pin").getAttribute("aria-disabled")).toBeNull();
    expect(row("Pin").dataset.need).toBe("sessions.patch");
    await click(row("Move to"));
    expect(row("Group…").getAttribute("aria-disabled")).toBeNull();
    expect(row("Group…").dataset.need).toBe("sessions.groups.list sessions.patch");
    await press(document.querySelector(".g-menu")!, "ArrowLeft");
    await click(row("Ledger"));
    expect(row("Pause").getAttribute("aria-disabled")).toBe("true");
    expect(comingControls()).toEqual(expect.arrayContaining([expect.objectContaining({ need: ["agents.update"], where: "Pause" })]));
    await press(document.querySelector(".g-menu")!, "ArrowLeft");
    await click(row("Pin"));
    expect(request).toHaveBeenCalledWith("sessions.patch", expect.objectContaining({ key: "agent:ledger:main", pinned: true }));
  });

  it("Guide › Take the full tour starts the window's walkthrough when the window offers it (parity row 14)", async () => {
    const onTour = vi.fn();
    await render([], { onTour });
    await click(host.querySelector(".r1sb-me"));
    await click(row("Guide"));
    expect(undeclared()).toEqual([]);
    expect(row("Take the full tour").hasAttribute("data-local")).toBe(true);
    expect(row("Take the full tour").getAttribute("aria-disabled")).toBeNull();
    await click(row("Take the full tour"));
    expect(onTour).toHaveBeenCalledTimes(1);
  });
});
