// @vitest-environment jsdom
import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import type { Conversation } from "../connect/conversations";
import type { Block } from "../thread/model";
import { Sidebar, type SidebarProps } from "./Sidebar";
import { buildContactSections, projectContact } from "./contacts-model";
import { readPrefs } from "./FilterSort";
import { rowMenuItems } from "./row-menu";
import { GroupDropPopover, createDroppedGroup, groupHint, groupPlan, mergeRoomNotices, moveContactToProject, roomContact, useRoomNotices, type GroupContact, type GroupRoom } from "./group-drop";
import type { SidebarDrop } from "./sidebar-drag";

vi.mock("../face/Face", () => ({ Face: ({ size }: { size: number }) => <span style={{ width: size, height: size }} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
const anchor = { left: 20, bottom: 70 } as DOMRect;
const contact = (id: string, name: string, kind: "trunk" | "outside", where?: string): GroupContact => ({
  id: `${kind === "trunk" ? "trunk" : "a2a"}:${id}`, kind, name, ...(where ? { where } : {}),
  threadKey: kind === "trunk" ? `agent:${id}:main` : `a2a:${id}`, isDefault: false,
  lastActivityAt: 1, preview: { kind: "message", text: "", at: 1 }, unreadTopics: 0,
  threadUnread: false, needsYou: false, working: false, topicCount: 0,
});
const scout = contact("scout", "Scout", "trunk");
const ledger = contact("ledger", "Ledger", "outside", "online");
const hermes = { ...contact("hermes", "Hermes", "outside"), offline: true };
const room: GroupRoom = { roomId: "r1", name: "Supplier quotes", lead: "scout", createdAt: 3, members: [{ kind: "trunk", id: "scout" }, { kind: "a2a", id: "ledger" }] };
const contacts = [scout, ledger, hermes, roomContact(room)!];
const drop = (source: GroupContact, target: GroupContact, zone: SidebarDrop["zone"] = "onto"): SidebarDrop => ({ source: source.threadKey, target: target.threadKey, zone });
const row = (contact: GroupContact, pinned = false): Conversation => ({ key: contact.threadKey, title: contact.name, kind: contact.kind, agentId: contact.kind === "trunk" ? contact.id.slice(6) : undefined, isMain: false, pinned, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 1, preview: "", working: false, system: false, automation: false, totalTokens: 0, contextTokens: 0 });
async function sidebar(pinnedLedger = false) {
  const onGroupDrop = vi.fn(), onReorderPins = vi.fn(), onMenu = vi.fn(), onOpen = vi.fn();
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  const props: SidebarProps = { sections: [{ id: "pinned", label: "Pinned", rows: [row(scout, true), ...(pinnedLedger ? [row(ledger, true)] : [])] }, { id: "recent", label: "Recent", rows: [...(pinnedLedger ? [] : [row(ledger)]), row(hermes)] }], openKey: null, currentPlace: null, now: 1, showPreview: false, rowState: () => ({ waiting: false, working: false }), trunkName: (id) => id ?? "", personName: "Owner", hasUnread: false, filterSlot: null, summary: null, emptyLine: null, search: null, searchResults: null, rail: false, onRailSearch: () => {}, onOpen, onNew: () => {}, onMenu, onPin: () => {}, onArchive: () => {}, onMarkAllRead: () => {}, onPerson: () => {}, onSettings: () => {}, onGroupDrop, onReorderPins, dropHint: () => "Start a group with Ledger" };
  await act(async () => root!.render(<Sidebar {...props} />));
  const side = host.querySelector<HTMLElement>(".side")!;
  const source = host.querySelector<HTMLElement>(`.pin-tile[data-drag-key="${scout.threadKey}"] .pin-open`)!;
  const target = host.querySelector<HTMLElement>(pinnedLedger ? `.pin-tile[data-drag-key="${ledger.threadKey}"]` : `.row[data-drag-key="${ledger.threadKey}"]`)!;
  Object.defineProperty(side, "setPointerCapture", { value: () => {} });
  Object.defineProperty(side, "hasPointerCapture", { value: () => false });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
  Object.defineProperty(target, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, top: 100, width: 120, height: 56, right: 220, bottom: 156 }) });
  const pointer = async (el: Element, type: string, pointerType: string, x: number, y: number) => act(async () => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType, button: 0, clientX: x, clientY: y })));
  return { host, source, target, side, onGroupDrop, onReorderPins, onMenu, onOpen, pointer };
}
function fakeSession() {
  const request = vi.fn(async (method: string, params: any) => {
    if (method === "rooms.create") return { room: { ...room, roomId: "new", name: params.name, members: params.members } };
    if (method === "rooms.members.add") return { room: { ...room, members: [...room.members, { kind: params.kind, id: params.id }] } };
    return {};
  });
  return { session: { request } as unknown as SaplingSession, request };
}
async function show(props: Partial<Parameters<typeof GroupDropPopover>[0]> = {}) {
  const { session, request } = fakeSession();
  const onClose = vi.fn(), onOpen = vi.fn();
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  const values = { drop: { kind: "new" as const, source: scout.threadKey, target: ledger.threadKey, anchor }, contacts, rooms: [room], defaultTrunk: "scout", session, onClose, onOpen, ...props };
  await act(async () => root!.render(<GroupDropPopover {...values} />));
  return { host, request, onClose, onOpen, values };
}

describe("drag to group", () => {
  it("distinguishes center grouping from pinned gap reorder, self drops, and duplicate room members", () => {
    expect(groupPlan(drop(scout, ledger), contacts, [room])).toBe("new");
    expect(groupHint(drop(scout, ledger), contacts, [room])).toBe("Start a group with Ledger");
    expect(groupHint(drop(scout, ledger, "before"), contacts, [room])).toBe("Move here");
    expect(groupPlan(drop(scout, scout), contacts, [room])).toBeNull();
    expect(groupPlan(drop(scout, contacts[3]!), contacts, [room])).toBe("duplicate");
    expect(groupHint(drop(scout, contacts[3]!), contacts, [room])).toBe("Already in this group");
    expect(groupPlan(drop(hermes, contacts[3]!), contacts, [room])).toBe("add");
    expect(groupHint(drop(hermes, contacts[3]!), contacts, [room])).toBe("Add Hermes to Supplier quotes");
  });
  it("rejects a chat-group contact as the person added to a room", () => {
    const chatGroup: GroupContact = { ...hermes, id: "chatGroup:team", kind: "chatGroup", threadKey: "agent:scout:chat-group:team", name: "Other group" };
    const rows = [...contacts, chatGroup];
    expect(groupPlan(drop(chatGroup, contacts[3]!), rows, [room])).toBeNull();
    expect(groupPlan(drop(contacts[3]!, chatGroup), rows, [room])).toBeNull();
    expect(groupHint(drop(chatGroup, contacts[3]!), rows, [room])).toBe("");
  });
  it("places created and member-added notices at their event times in conversation history", async () => {
    const request = vi.fn(async () => ({ events: [
      { seq: 1, kind: "created", payload: { members: room.members }, createdAt: 100 },
      { seq: 2, kind: "member.added", payload: { kind: "a2a", id: "hermes" }, createdAt: 300 },
    ] }));
    const session = { request, onGatewayEvent: () => () => {} } as unknown as SaplingSession;
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    let notices: Block[] = [];
    function Probe() { notices = useRoomNotices(session, contacts[3]!.threadKey, contacts); return null; }
    await act(async () => root!.render(<Probe />));
    const history: Block[] = [
      { kind: "user", key: "first", text: "First", meta: { timestamp: 200 } },
      { kind: "text", key: "reply", text: "Reply", streaming: false },
      { kind: "user", key: "second", text: "Second", meta: { timestamp: 400 } },
    ];
    expect(mergeRoomNotices(history, notices).map((block) => block.key)).toEqual(["room:r1:1", "first", "reply", "room:r1:2", "second"]);
    expect(notices[1]).toMatchObject({ text: "You added Hermes", at: 300 });
  });
  it("creates a real room with both contacts and a lead Trunk through rooms.create", async () => {
    const { session, request } = fakeSession();
    const made = await createDroppedGroup(session, contacts, [scout.threadKey, ledger.threadKey], "Hartwell check", "scout");
    expect(made.name).toBe("Hartwell check");
    expect(request).toHaveBeenCalledWith("rooms.create", { name: "Hartwell check", members: [{ kind: "trunk", id: "scout", role: "lead" }, { kind: "a2a", id: "ledger", role: "member" }] });
    await createDroppedGroup(session, contacts, [ledger.threadKey, hermes.threadKey], "Both grafted", "scout");
    expect(request).toHaveBeenLastCalledWith("rooms.create", { name: "Both grafted", members: [{ kind: "a2a", id: "ledger", role: "member" }, { kind: "a2a", id: "hermes", role: "member" }, { kind: "trunk", id: "scout", role: "lead" }] });
  });
  it("lists a new room first in Groups with its two real member faces", () => {
    const grouped = roomContact(room, [scout, ledger])!;
    expect(grouped.roomPicks?.map((pick) => pick.name)).toEqual(["Scout", "Ledger"]);
    const sections = buildContactSections(projectContact([scout, ledger, grouped], []), readPrefs(), 10);
    expect(sections.find((section) => section.label === "Groups")?.rows[0]).toMatchObject({ title: "Supplier quotes", roomPicks: grouped.roomPicks });
  });
  it("moves a contact dropped on a project through sessions.patch", async () => {
    const { session, request } = fakeSession();
    await moveContactToProject(session, scout.threadKey, "branch");
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: scout.threadKey, projectId: "branch" });
  });
  it("keeps the standalone new-group popover and typed name across a sidebar redraw, then creates on Enter", async () => {
    const rendered = await show();
    const input = rendered.host.querySelector<HTMLInputElement>("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Hartwell check"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => root!.render(<GroupDropPopover {...rendered.values} />));
    expect(rendered.host.querySelector<HTMLInputElement>("input")?.value).toBe("Hartwell check");
    await act(async () => rendered.host.querySelector<HTMLInputElement>("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(rendered.request).toHaveBeenCalledWith("rooms.create", expect.objectContaining({ name: "Hartwell check" }));
    expect(rendered.onOpen).toHaveBeenCalledWith("agent:scout:room:new");
  });
  it("puts both dropped chats in the rooms.create group after confirming a new pair", async () => {
    expect(groupPlan(drop(scout, ledger), contacts, [room])).toBe("new");
    const rendered = await show();
    await act(async () => rendered.host.querySelector<HTMLButtonElement>("[data-testid=start-group-with-these]")!.click());
    const created = rendered.request.mock.calls.find(([method]) => method === "rooms.create");
    expect(created).toBeTruthy();
    const members = (created![1] as { members: { kind: string; id: string }[] }).members;
    expect(members.map((member) => `${member.kind}:${member.id}`)).toEqual(["trunk:scout", "a2a:ledger"]);
    expect(rendered.onOpen).toHaveBeenCalledWith("agent:scout:room:new");
  });
  it("offers Add both to… on a new-group confirm and adds the missing members", async () => {
    const other: GroupRoom = { roomId: "r2", name: "Week plan", lead: "scout", createdAt: 4, members: [{ kind: "trunk", id: "scout" }] };
    const rendered = await show({ rooms: [other] });
    expect(rendered.host.textContent).toContain("Add both to…");
    expect(rendered.host.textContent).toContain("Week plan");
    const button = [...rendered.host.querySelectorAll<HTMLButtonElement>("button.mi")].find((el) => el.textContent === "Week plan");
    await act(async () => button!.click());
    expect(rendered.request).toHaveBeenCalledWith("rooms.members.add", { roomId: "r2", kind: "a2a", id: "ledger" });
    expect(rendered.request).not.toHaveBeenCalledWith("rooms.members.add", expect.objectContaining({ id: "scout" }));
    expect(rendered.onOpen).toHaveBeenCalledWith("agent:scout:room:r2");
  });
  it("asks before adding a grafted contact, notes it is offline, and calls rooms.members.add", async () => {
    const rendered = await show({ drop: { kind: "add", source: hermes.threadKey, target: contacts[3]!.threadKey, anchor } });
    expect(rendered.host.textContent).toContain("Add Hermes to Supplier quotes?");
    expect(rendered.host.textContent).toContain("Hermes is offline. It joins when it’s back.");
    await act(async () => rendered.host.querySelector<HTMLButtonElement>(".group-drop-actions .pri")!.click());
    expect(rendered.request).toHaveBeenCalledWith("rooms.members.add", { roomId: "r1", kind: "a2a", id: "hermes" });
    expect(rendered.onOpen).toHaveBeenCalledWith("agent:scout:room:r1");
  });
  it("offers the keyboard picker for existing groups and contacts, and Escape cancels", async () => {
    const onPick = vi.fn();
    const rendered = await show({ drop: { kind: "pick", source: hermes.threadKey, anchor }, onPick });
    expect(rendered.host.textContent).toContain("Add Hermes to");
    expect(rendered.host.textContent).toContain("Start a group with");
    await act(async () => rendered.host.querySelector<HTMLButtonElement>(".mi")!.click());
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: "add", roomId: "r1" }));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(rendered.onClose).toHaveBeenCalled();
  });
  it("offers Move to group in the contact row menu as the keyboard path", () => {
    const moveToGroup = vi.fn();
    const items = rowMenuItems(row(scout), { contact: { ...scout, thread: null }, moveToGroup, now: 1, level: "regular", trunkName: "Scout" } as unknown as Parameters<typeof rowMenuItems>[1]);
    const item = items.find((candidate) => "testid" in candidate && candidate.testid === "menu-move-to-group");
    expect(item).toMatchObject({ label: "Move to group…" });
    if (item && "run" in item) item.run();
    expect(moveToGroup).toHaveBeenCalledWith(expect.objectContaining({ id: scout.id }));
  });
  it("uses the shared pinned pointer path for mouse and pen center drops", async () => {
    const ui = await sidebar();
    await ui.pointer(ui.source, "pointerdown", "mouse", 10, 10);
    await ui.pointer(ui.source, "pointermove", "mouse", 120, 120);
    expect(ui.host.ownerDocument.getElementById("sidebar-drag-ghost")?.textContent).toContain("Start a group with Ledger");
    await ui.pointer(ui.source, "pointerup", "mouse", 120, 120);
    expect(ui.onGroupDrop).toHaveBeenCalledWith({ source: scout.threadKey, target: ledger.threadKey, zone: "onto" }, expect.anything());
    await ui.pointer(ui.source, "pointerdown", "pen", 10, 10);
    await ui.pointer(ui.source, "pointermove", "pen", 120, 120);
    await ui.pointer(ui.source, "pointerup", "pen", 120, 120);
    expect(ui.onGroupDrop).toHaveBeenCalledTimes(2);
  });
  it("uses pinned gaps for reorder and pinned centers for grouping on the same pointer path", async () => {
    const ui = await sidebar(true);
    const source = ui.host.querySelector<HTMLElement>(`.pin-tile[data-drag-key="${ledger.threadKey}"] .pin-open`)!;
    const tile = ui.host.querySelector<HTMLElement>(`.pin-tile[data-drag-key="${scout.threadKey}"]`)!;
    Object.defineProperty(tile, "getBoundingClientRect", { value: () => ({ left: 100, top: 100, width: 60, height: 70, right: 160, bottom: 170 }) });
    Object.defineProperty(ui.target, "getBoundingClientRect", { value: () => ({ left: 170, top: 100, width: 60, height: 70, right: 230, bottom: 170 }) });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => ui.host.querySelector(".pin-grid") });
    await ui.pointer(source, "pointerdown", "mouse", 180, 130);
    await ui.pointer(source, "pointermove", "mouse", 96, 130);
    await ui.pointer(source, "pointerup", "mouse", 96, 130);
    expect(ui.onReorderPins).toHaveBeenCalledWith({ source: ledger.threadKey, target: scout.threadKey, zone: "before" }, expect.anything());
    expect(ui.onGroupDrop).not.toHaveBeenCalled();
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => tile });
    await ui.pointer(source, "pointerdown", "mouse", 180, 130);
    await ui.pointer(source, "pointermove", "mouse", 130, 130);
    await ui.pointer(source, "pointerup", "mouse", 130, 130);
    expect(ui.onGroupDrop).toHaveBeenCalledWith({ source: ledger.threadKey, target: scout.threadKey, zone: "onto" }, expect.anything());
  });
  it("does not turn the Pinned label or empty space into a contact-on-contact drop", async () => {
    const ui = await sidebar(true);
    const source = ui.host.querySelector<HTMLElement>(`.pin-tile[data-drag-key="${ledger.threadKey}"] .pin-open`)!;
    const label = ui.host.querySelector<HTMLElement>('.list-sec[data-section="pinned"]')!;
    const tile = ui.host.querySelector<HTMLElement>(`.pin-tile[data-drag-key="${scout.threadKey}"]`)!;
    Object.defineProperty(tile, "getBoundingClientRect", { value: () => ({ left: 100, top: 100, width: 60, height: 70, right: 160, bottom: 170 }) });
    Object.defineProperty(ui.target, "getBoundingClientRect", { value: () => ({ left: 170, top: 100, width: 60, height: 70, right: 230, bottom: 170 }) });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => label });
    await ui.pointer(source, "pointerdown", "mouse", 180, 130);
    await ui.pointer(source, "pointermove", "mouse", 96, 130);
    await ui.pointer(source, "pointerup", "mouse", 96, 130);
    expect(ui.onGroupDrop).not.toHaveBeenCalled();
    expect(ui.onReorderPins).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount()); root = undefined;
    const ui2 = await sidebar(false);
    const empty = ui2.host.querySelector<HTMLElement>('.list-sec[data-section="pinned"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => empty });
    const recent = ui2.target.querySelector<HTMLElement>(".row-open")!;
    await ui2.pointer(recent, "pointerdown", "mouse", 10, 10);
    await ui2.pointer(recent, "pointermove", "mouse", 130, 60);
    await ui2.pointer(recent, "pointerup", "mouse", 130, 60);
    expect(ui2.onGroupDrop).not.toHaveBeenCalled();
  });
  it("allows a quick touch swipe from a row to scroll the sidebar", async () => {
    const ui = await sidebar();
    const scroll = ui.host.querySelector<HTMLElement>(".side-scroll")!;
    const css = readFileSync("src/shell/group-drop.css", "utf8");
    expect(css).not.toMatch(/\[data-drag-key\]\s*\{\s*touch-action:\s*none/);
    scroll.scrollTop = 10;
    await ui.pointer(ui.source, "pointerdown", "touch", 10, 10);
    await ui.pointer(ui.source, "pointermove", "touch", 10, 50);
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    ui.source.dispatchEvent(move);
    if (!move.defaultPrevented) scroll.scrollTop += 40;
    expect(move.defaultPrevented).toBe(false);
    expect(scroll.scrollTop).toBe(50);
    expect(document.getElementById("sidebar-drag-ghost")).toBeNull();
  });
  it("requires a 350 ms touch hold, leaves a quick swipe alone, and Esc cancels a drag", async () => {
    vi.useFakeTimers();
    try {
      const ui = await sidebar();
      await ui.pointer(ui.source, "pointerdown", "touch", 10, 10);
      await act(async () => vi.advanceTimersByTime(349));
      expect(document.getElementById("sidebar-drag-ghost")).toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(document.getElementById("sidebar-drag-ghost")).not.toBeNull();
      await ui.pointer(ui.source, "pointermove", "touch", 120, 120);
      await ui.pointer(ui.source, "pointerup", "touch", 120, 120);
      expect(ui.onGroupDrop).toHaveBeenCalledTimes(1);
      await ui.pointer(ui.source, "pointerdown", "touch", 10, 10);
      await act(async () => vi.advanceTimersByTime(350));
      await ui.pointer(ui.source, "pointerup", "touch", 10, 10);
      expect(ui.onMenu).toHaveBeenCalledTimes(1);
      await ui.pointer(ui.source, "pointerdown", "touch", 10, 10);
      await ui.pointer(ui.source, "pointermove", "touch", 10, 50);
      await act(async () => vi.advanceTimersByTime(500));
      expect(document.getElementById("sidebar-drag-ghost")).toBeNull();
      await ui.pointer(ui.source, "pointerdown", "pen", 10, 10);
      await ui.pointer(ui.source, "pointermove", "pen", 120, 120);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await ui.pointer(ui.source, "pointerup", "pen", 120, 120);
      await act(async () => ui.source.click());
      expect(ui.onGroupDrop).toHaveBeenCalledTimes(1);
      expect(ui.onOpen).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("auto-scrolls the contact list while dragging near its edge", async () => {
    const ui = await sidebar();
    const scroll = ui.host.querySelector<HTMLElement>(".side-scroll")!;
    scroll.scrollTop = 80;
    Object.defineProperty(scroll, "getBoundingClientRect", { value: () => ({ left: 0, right: 300, top: 0, bottom: 200 }) });
    await ui.pointer(ui.source, "pointerdown", "mouse", 10, 80);
    await ui.pointer(ui.source, "pointermove", "mouse", 120, 10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroll.scrollTop).toBeLessThan(80);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.getElementById("sidebar-drag-ghost")).toBeNull();
  });
});
