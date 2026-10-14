import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../connect/conversations";
import type { Actions } from "../../shell/conversation-actions";
import type { Contact } from "../../shell/contacts-model";
import { contactRows, type SideRow } from "./model";
import { DEFAULT_AWAKE, DEFAULT_LISTED, FIRST_MESSAGE, PAUSE_OFF, rowMenu, type RowMenuContext } from "./row-menu";

const thread = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", snoozedUntil: null, working: false } as unknown as Conversation;
const contact = (over: Partial<Contact>): Contact => ({
  id: "trunk:ledger", kind: "trunk", name: "Ledger", threadKey: "agent:ledger:main", isDefault: false, lastActivityAt: 1,
  preview: { kind: "message", text: "hi", at: 1 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, thread, ...over,
} as Contact);
const rowOf = (over: Partial<Contact>): SideRow => contactRows([contact(over)], new Map(), () => [])[0];
const ctx = (over: Partial<RowMenuContext> = {}): RowMenuContext => ({
  now: new Date(2026, 9, 12, 12).getTime(), projects: [], ownWindowOff: null,
  actions: { snooze: vi.fn(), setUnread: vi.fn(), archive: vi.fn(), restore: vi.fn(), copyConversation: vi.fn() } as unknown as Actions,
  open: vi.fn(), pin: vi.fn(), markRead: vi.fn(), archiveRoom: vi.fn(), unarchiveRoom: vi.fn(), rename: vi.fn(), moveToProject: vi.fn(), moveToGroup: vi.fn(), newConversation: vi.fn(),
  copyLink: vi.fn(), copyMarkdown: vi.fn(), copyText: vi.fn(), ownWindow: vi.fn(), ask: vi.fn(), editTrunk: vi.fn(), tidy: vi.fn(),
  removeTrunk: vi.fn(), confirmDelete: vi.fn(), ...over,
});

describe("row ••• menu", () => {
  it("has four tiles and seven rows for a Trunk, with every shortcut letter", () => {
    const { tiles, rows } = rowMenu(rowOf({}), ctx());
    expect(tiles.map(tile => tile.label)).toEqual(["Pin", "Unread", "Snooze", "Archive"]);
    expect(rows.map(row => row.label)).toEqual(["Rename", "Move to", "New conversation", "Copy", "Open in new window", "Ledger", "Delete conversation…"]);
    expect([...tiles, ...rows].map(entry => entry.letter).filter(Boolean)).toEqual(["p", "u", "a", "r", "f", "c", "d"]);
    expect(rows.at(-1)).toMatchObject({ danger: true, gap: true });
    expect(rows.find(row => row.label === "Ledger")?.submenu?.map(entry => entry.label)).toEqual(["What can it do?", "Pause", "Edit Trunk…", "Tidy up", "Remove Ledger…"]);
  });
  it("runs the engine actions it names", () => {
    const c = ctx();
    const { tiles, rows } = rowMenu(rowOf({}), c);
    tiles[0].onSelect?.();
    expect(c.pin).toHaveBeenCalled();
    tiles[2].submenu?.[0].onSelect?.();
    expect(c.actions.snooze).toHaveBeenCalledWith(thread, expect.any(Number));
    rows.find(row => row.label === "New conversation")?.submenu?.[0].onSelect?.();
    expect(c.newConversation).toHaveBeenCalledWith("ledger");
    rows.at(-1)?.onSelect?.();
    expect(c.confirmDelete).toHaveBeenCalledWith(thread);
  });
  it("gives the default agent disabled Snooze and Archive tiles with their reasons, and no Delete", () => {
    const { tiles, rows } = rowMenu(rowOf({ isDefault: true }), ctx());
    expect(tiles.find(tile => tile.label === "Snooze")?.off).toBe(DEFAULT_AWAKE);
    expect(tiles.find(tile => tile.label === "Archive")?.off).toBe(DEFAULT_LISTED);
    expect(rows.some(row => row.label.startsWith("Delete"))).toBe(false);
    expect(rows.find(row => row.label === "Ledger")?.submenu?.some(entry => entry.label.startsWith("Remove"))).toBe(false);
  });
  it("hides Open in new window when this window can't, and says why unwired rows can't run", () => {
    const { rows } = rowMenu(rowOf({}), ctx({ ownWindowOff: "Only in the desktop app." }));
    expect(rows.some(row => row.label === "Open in new window")).toBe(false);
    expect(rows.find(row => row.label === "Ledger")?.submenu?.find(entry => entry.label === "Pause")?.off).toBe(PAUSE_OFF);
  });
  it("asks for a first message before acting on a conversation that doesn't exist yet", () => {
    const { tiles } = rowMenu(rowOf({ thread: null }), ctx());
    expect(tiles.find(tile => tile.label === "Pin")?.off).toBe(FIRST_MESSAGE);
    expect(tiles.find(tile => tile.label === "Unread")?.off).toBe(FIRST_MESSAGE);
    expect(tiles.find(tile => tile.label === "Snooze")?.off).toBe(FIRST_MESSAGE);
  });
  it("archives a group through its room", () => {
    const c = ctx();
    const { tiles, rows } = rowMenu(rowOf({ id: "room:r1", kind: "group", name: "Quotes", roomId: "r1" } as Partial<Contact>), c);
    tiles[3].onSelect?.();
    expect(c.archiveRoom).toHaveBeenCalled();
    expect(rows.some(row => row.label === "New conversation")).toBe(false);
  });
});
