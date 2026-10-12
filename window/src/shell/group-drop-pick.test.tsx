// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import { NEW_GROUP_EVENT } from "../rooms/NewGroupChat";
import { GroupDropPopover, groupPlan, roomContact, type GroupContact, type GroupRoom } from "./group-drop";
import type { SidebarDrop } from "./sidebar-drag";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const anchor = { left: 20, bottom: 70 } as DOMRect;
const contact = (id: string, name: string, kind: "trunk" | "outside"): GroupContact => ({
  id: `${kind === "trunk" ? "trunk" : "a2a"}:${id}`, kind, name,
  threadKey: kind === "trunk" ? `agent:${id}:main` : `a2a:${id}`, isDefault: false,
  lastActivityAt: 1, preview: { kind: "message", text: "", at: 1 }, unreadTopics: 0,
  threadUnread: false, needsYou: false, working: false, topicCount: 0,
});
const scout = contact("scout", "Scout", "trunk");
const ledger = contact("ledger", "Ledger", "outside");
const room: GroupRoom = { roomId: "r1", name: "Supplier quotes", lead: "scout", createdAt: 3, members: [{ kind: "trunk", id: "scout" }, { kind: "a2a", id: "ledger" }] };

async function show(props: Partial<Parameters<typeof GroupDropPopover>[0]> = {}) {
  const request = vi.fn(async (method: string, params: { name?: string; members?: { kind: string; id: string }[]; roomId?: string; kind?: string; id?: string }) => {
    if (method === "rooms.create") return { room: { roomId: "new", name: params.name, lead: "scout", createdAt: 1, members: params.members } };
    if (method === "rooms.members.add") return {};
    return {};
  });
  const session = { request } as unknown as SaplingSession;
  const onClose = vi.fn(), onOpen = vi.fn(), onPick = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<GroupDropPopover
    drop={{ kind: "pick", source: scout.threadKey, anchor }}
    contacts={[scout]} rooms={[]} defaultTrunk="scout" session={session}
    onClose={onClose} onOpen={onOpen} onPick={onPick} {...props} />));
  return { host, onClose, onOpen, onPick, request };
}

describe("Move to group pick popover", () => {
  it("shows the empty line and a New group chat… entry that calls openNewGroupChat", async () => {
    const opened = vi.fn();
    window.addEventListener(NEW_GROUP_EVENT, opened);
    const rendered = await show();
    expect(rendered.host.textContent).toContain("Nobody to start a group with.");
    expect(rendered.host.textContent).toContain("New group chat…");
    expect(rendered.host.textContent).not.toContain("Start a group with");
    expect(rendered.host.textContent).not.toContain("Add Scout to");
    const button = [...rendered.host.querySelectorAll("button")].find((el) => el.textContent === "New group chat…");
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(opened).toHaveBeenCalledTimes(1);
    expect(rendered.onClose).toHaveBeenCalledTimes(1);
    window.removeEventListener(NEW_GROUP_EVENT, opened);
  });

  it("puts both dropped chats in the rooms.create group after confirming a new pair", async () => {
    const drop: SidebarDrop = { source: scout.threadKey, target: ledger.threadKey, zone: "onto" };
    expect(groupPlan(drop, [scout, ledger], [])).toBe("new");
    const rendered = await show({
      drop: { kind: "new", source: scout.threadKey, target: ledger.threadKey, anchor },
      contacts: [scout, ledger],
    });
    await act(async () => rendered.host.querySelector<HTMLButtonElement>("[data-testid=start-group-with-these]")!.click());
    const created = rendered.request.mock.calls.find(([method]) => method === "rooms.create");
    expect(created).toBeTruthy();
    const members = (created![1] as { members: { kind: string; id: string }[] }).members;
    expect(members.map((member) => `${member.kind}:${member.id}`)).toEqual(["trunk:scout", "a2a:ledger"]);
    expect(rendered.onOpen).toHaveBeenCalledWith("agent:scout:room:new");
  });
  it("offers Add both to… on a new-group confirm and adds the missing members", async () => {
    const other: GroupRoom = { roomId: "r2", name: "Week plan", lead: "scout", createdAt: 4, members: [{ kind: "trunk", id: "scout" }] };
    const rendered = await show({
      drop: { kind: "new", source: scout.threadKey, target: ledger.threadKey, anchor },
      contacts: [scout, ledger],
      rooms: [other],
    });
    expect(rendered.host.textContent).toContain("Add both to…");
    const button = [...rendered.host.querySelectorAll<HTMLButtonElement>("button.mi")].find((el) => el.textContent === "Week plan");
    await act(async () => button!.click());
    expect(rendered.request).toHaveBeenCalledWith("rooms.members.add", { roomId: "r2", kind: "a2a", id: "ledger" });
    expect(rendered.onOpen).toHaveBeenCalledWith("agent:scout:room:r2");
  });
  it("lists the group under Add <name> to and the contact under Start a group with", async () => {
    const rendered = await show({ contacts: [scout, ledger, roomContact(room)!], rooms: [room] });
    expect(rendered.host.textContent).toContain("Add Scout to");
    expect(rendered.host.textContent).toContain("Supplier quotes");
    expect(rendered.host.textContent).toContain("Start a group with");
    expect(rendered.host.textContent).toContain("Ledger");
    expect(rendered.host.textContent).not.toContain("Nobody to start a group with.");
    expect(rendered.host.textContent).not.toContain("New group chat…");
    const buttons = [...rendered.host.querySelectorAll<HTMLButtonElement>("button.mi")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Supplier quotes · Already in this group", "Ledger"]);
    await act(async () => buttons[1]!.click());
    expect(rendered.onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: "new", source: scout.threadKey, target: ledger.threadKey }));
  });
});
