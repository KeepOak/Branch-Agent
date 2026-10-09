import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Contact as GatewayContact } from "@branch/gateway-protocol";
import { afterEach, expect, it, vi } from "vitest";
import { projectConversation } from "../connect/conversations";
import { SaplingSession } from "../connect/session";
import { conversationActions } from "./conversation-actions";
import { conversationMenuItems, type ConversationMenuRun } from "./conversation-menu";
import { buildContactSections, missingConversation, openContactRow, pinContact, projectContact } from "./contacts-model";
import { DEFAULT_PREFS } from "./list-model";
import { Sidebar, type SidebarProps } from "./Sidebar";
import { rowMenuItems } from "./row-menu";

vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const raw = (id: string, lastActivityAt: number, extra: Partial<GatewayContact> = {}): GatewayContact => ({
  id: `trunk:${id}`, kind: "trunk", name: id === "tk" ? "TK" : `Builder ${id}`,
  threadKey: `agent:${id}:main`, isDefault: id === "tk", lastActivityAt,
  preview: { kind: "message", text: `${id} reply`, at: lastActivityAt },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const row = (key: string) => projectConversation({ key, updatedAt: 10, isMain: key.endsWith(":main") }, null);

function sidebar(contacts: ReturnType<typeof projectContact>, onOpen: (key: string) => void): SidebarProps {
  return {
    sections: buildContactSections(contacts, DEFAULT_PREFS, 100), openKey: null, currentPlace: null,
    now: 100, showPreview: true, rowState: () => ({ waiting: false, working: false }),
    trunkName: (id) => id ?? "", personName: "Owner", hasUnread: false,
    filterSlot: null, summary: null, emptyLine: null, search: null, searchResults: null,
    rail: false, onRailSearch: () => {}, onOpen, onNew: () => {}, onMenu: () => {},
    onPin: () => {}, onArchive: () => {}, onMarkAllRead: () => {}, onPerson: () => {}, onSettings: () => {},
  };
}

it.each([
  ["default Trunk", "tk", [row("agent:tk:main")]],
  ["Trunk with a main session", "elm", [row("agent:elm:main")]],
  ["Trunk without sessions", "ash", []],
  ["Trunk with only other sessions", "oak", [row("agent:oak:topic-1")]],
] as const)("opens and sends from the %s contact's own thread", async (_case, id, sessions) => {
  const contacts = projectContact(id === "tk" ? [raw("tk", 10)] : [raw("tk", 10), raw(id, 20)], sessions);
  const session = new SaplingSession("ws://localhost:1", undefined);
  const request = vi.spyOn((session as unknown as { gateway: { request: (method: string, params: unknown) => Promise<unknown> } }).gateway, "request")
    .mockImplementation(async (method) => method === "chat.history" ? { messages: [] } : {});
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Sidebar {...sidebar(contacts, (key) => { void session.open(key); })} />));
  const target = container.querySelector<HTMLButtonElement>(`[data-key="agent:${id}:main"] .row-open`);
  expect(target).not.toBeNull();
  await act(async () => target!.click());
  expect(session.getSnapshot().sessionKey).toBe(`agent:${id}:main`);
  expect(openContactRow(session.getSnapshot().sessionKey, contacts, sessions)?.title).toBe(id === "tk" ? "TK" : `Builder ${id}`);
  await act(async () => session.send("hello"));
  expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: `agent:${id}:main`, message: "hello" }));
});

it("redirects only a key absent from both sessions and loaded contacts", () => {
  const contacts = projectContact([raw("tk", 10), raw("elm", 20)], []);
  expect(missingConversation("agent:elm:main", "agent:tk:main", true, contacts, [])).toBe(false);
  expect(missingConversation("agent:elm:topic", "agent:tk:main", true, contacts, [row("agent:elm:topic")])).toBe(false);
  expect(missingConversation("agent:gone:main", "agent:tk:main", false, contacts, [])).toBe(false);
  expect(missingConversation("agent:gone:main", "agent:tk:main", true, contacts, [])).toBe(true);
});

it("offers Pin but not Archive or Delete on the default Trunk's conversation menu", () => {
  const [contact] = projectContact([raw("tk", 10)], []);
  const items = conversationMenuItems({
    row: openContactRow(contact.threadKey, [contact], []), isMain: true, trunkName: "TK",
    ownTrunk: false, canRemoveTrunk: false, mac: false, now: 100,
    hasReply: false, talkOff: null,
    run: new Proxy({}, { get: () => vi.fn() }) as ConversationMenuRun,
  });
  expect(items.some((item) => item.kind === undefined && item.label === "Pin")).toBe(true);
  expect(items.some((item) => item.kind === undefined && (item.label === "Archive" || item.label === "Delete this conversation…"))).toBe(false);
});

it("orders TK by activity and moves it through Pinned on menu pin and unpin", async () => {
  let raws = [raw("tk", 10), raw("elm", 20)];
  const sections = () => buildContactSections(projectContact(raws, []), DEFAULT_PREFS, 100);
  expect(sections().find((s) => s.id === "recent")?.rows.map((r) => r.key)).toEqual(["agent:elm:main", "agent:tk:main"]);
  const request = vi.fn(async (method: string, params: unknown) => {
    if (method === "sessions.patch" || method === "sessions.patchMany") {
      const pinned = (params as { pinned?: boolean; patch?: { pinned: boolean } }).pinned ?? (params as { patch?: { pinned: boolean } }).patch?.pinned;
      raws = raws.map((c) => c.isDefault ? { ...c, pinnedAt: pinned ? 50 : undefined } : c);
    }
    return method === "contacts.topics" ? { topics: [] } : {};
  });
  const refreshList = vi.fn(async () => {});
  const refreshContacts = vi.fn();
  const actions = conversationActions(request as Parameters<typeof conversationActions>[0], { refresh: refreshList } as unknown as Parameters<typeof conversationActions>[1], () => null);
  const toggle = vi.fn((contact: ReturnType<typeof projectContact>[number]) => { void pinContact(contact, [], actions, request, refreshContacts); });
  const menu = () => {
    const contact = projectContact(raws, [])[0];
    return rowMenuItems(openContactRow(contact.threadKey, [contact], [])!, {
      actions, contact, pinContact: toggle,
      now: 100, trunkName: "TK", level: "regular", open: () => {}, rename: () => {}, confirmDelete: () => {},
      ask: () => {}, editTrunk: () => {}, tidy: () => {}, copyMarkdown: () => {},
      copyText: () => {}, copyLink: () => {}, copyConversation: () => {}, ownWindow: () => {},
    });
  };
  for (const [label, expectedPinned] of [["Pin", true], ["Unpin", false]] as const) {
    const item = menu().find((candidate) => candidate.kind === undefined && candidate.testid === "menu-pin");
    expect(item).toMatchObject({ label });
    if (!item || item.kind !== undefined) throw new Error("Pin action is missing");
    item.run();
    await vi.waitFor(() => expect(refreshContacts).toHaveBeenCalledTimes(expectedPinned ? 1 : 2));
    expect(Boolean(sections().find((s) => s.id === "pinned")?.rows.some((r) => r.key === "agent:tk:main"))).toBe(expectedPinned);
  }
  expect(request).toHaveBeenCalledWith("sessions.patch", expect.objectContaining({ key: "agent:tk:main", agentId: "tk", pinned: true }));
  expect(request).toHaveBeenCalledWith("sessions.patchMany", expect.objectContaining({ targets: [{ key: "agent:tk:main", agentId: "tk" }], patch: { pinned: false } }));
});
