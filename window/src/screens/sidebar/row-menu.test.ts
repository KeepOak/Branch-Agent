import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../connect/conversations";
import type { Actions } from "../../shell/conversation-actions";
import type { Contact } from "../../shell/contacts-model";
import { contactRows, type SideRow } from "./model";
import { DEFAULT_AWAKE, DEFAULT_FIRST, DEFAULT_LISTED, FIRST_MESSAGE, MAIN_STAYS, NO_PROJECTS, REPLACE_PIN, rowMenu, TRUNK_LISTED, type RowMenuContext } from "./row-menu";

const thread = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", snoozedUntil: null, working: false } as unknown as Conversation;
const contact = (over: Partial<Contact>): Contact => ({
  id: "trunk:ledger", kind: "trunk", name: "Ledger", threadKey: "agent:ledger:main", isDefault: false, lastActivityAt: 1,
  preview: { kind: "message", text: "hi", at: 1 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, thread, ...over,
} as Contact);
const rowOf = (over: Partial<Contact>): SideRow => contactRows([contact(over)], new Map(), () => [])[0];
const ctx = (over: Partial<RowMenuContext> = {}): RowMenuContext => ({
  now: new Date(2026, 9, 12, 12).getTime(), projects: [], ownWindowOff: null,
  actions: { snooze: vi.fn(), setUnread: vi.fn(), setDone: vi.fn(), archive: vi.fn(), restore: vi.fn(), copyConversation: vi.fn() } as unknown as Actions,
  open: vi.fn(), pin: vi.fn(), markRead: vi.fn(), archiveRoom: vi.fn(), unarchiveRoom: vi.fn(), rename: vi.fn(), renameTrunk: vi.fn(), moveToProject: vi.fn(), moveToGroup: vi.fn(), newConversation: vi.fn(),
  copyLink: vi.fn(), copyMarkdown: vi.fn(), copyText: vi.fn(), ownWindow: vi.fn(), ask: vi.fn(), editTrunk: vi.fn(), tidy: vi.fn(),
  removeTrunk: vi.fn(), confirmDelete: vi.fn(), replacePin: vi.fn(), ...over,
});

const TRUNK_ROWS = ["Open", "Mark as unread", "Pin to top", "Move to group…", "Rename", "Open in its own window", "Copy into a new conversation", "Copy", "Snooze", "Mark done", "Move to project", "Tidy up…", "New conversation with Ledger", "What can Ledger do?", "Edit Trunk…", "Delete…", "Remove…"];

describe("row ••• menu", () => {
  it("lists the preview's rows for a Trunk, with no tiles, in that order", () => {
    const { tiles, rows } = rowMenu(rowOf({}), ctx());
    expect(tiles).toEqual([]);
    expect(rows.map(row => row.label)).toEqual(TRUNK_ROWS);
    expect(rows.map(row => row.letter).filter(Boolean)).toEqual(["u", "p", "r", "f", "c", "d"]);
    expect(rows.find(row => row.label === "Snooze")?.gap).toBe(true);
    expect(rows.find(row => row.label === "Delete…")).toMatchObject({ danger: true, gap: true });
    expect(rows.find(row => row.label === "Remove…")).toMatchObject({ danger: true });
    expect(rows.find(row => row.label === "Copy")?.submenu?.map(entry => entry.label)).toEqual(["Link to this conversation", "Conversation as Markdown", "Conversation ID"]);
    expect(rows.find(row => row.label === "Mark done")).toMatchObject({ need: "sessions.patch" });
    expect(rows.find(row => row.label === "Mark done")?.off).toBeUndefined();
    expect(rows.some(row => row.label === "Archive" || row.label === "Pause")).toBe(false);
    expect(rows.find(row => row.label === "Copy")?.submenu?.some(entry => entry.label === "Link with a preview card")).toBe(false);
    expect(rows.find(row => row.label === "Move to project")?.off).toBe(NO_PROJECTS);
  });
  it("runs the engine actions it names", () => {
    const c = ctx();
    const { rows } = rowMenu(rowOf({}), c);
    rows.find(row => row.label === "Pin to top")?.onSelect?.();
    expect(c.pin).toHaveBeenCalled();
    rows.find(row => row.label === "Snooze")?.submenu?.[0].onSelect?.();
    expect(c.actions.snooze).toHaveBeenCalledWith(thread, expect.any(Number));
    rows.find(row => row.label === "New conversation with Ledger")?.onSelect?.();
    expect(c.newConversation).toHaveBeenCalledWith("ledger");
    rows.find(row => row.label === "Open")?.onSelect?.();
    expect(c.open).toHaveBeenCalledWith("agent:ledger:main");
    rows.find(row => row.label === "Delete…")?.onSelect?.();
    expect(c.confirmDelete).toHaveBeenCalledWith(thread);
    rows.find(row => row.label === "Mark done")?.onSelect?.();
    expect(c.actions.setDone).toHaveBeenCalledWith(thread, true);
  });
  it("renames a Trunk row in place through agents.update, never through Edit Trunk (walkthrough B-093, B-094)", () => {
    const c = ctx(), row = rowOf({});
    const rename = rowMenu(row, c).rows.find(entry => entry.label === "Rename")!;
    expect(rename).toMatchObject({ letter: "r", need: "agents.update" });
    rename.onSelect?.();
    expect(c.renameTrunk).toHaveBeenCalledWith("ledger", row);
    expect(c.editTrunk).not.toHaveBeenCalled();
  });
  it("keeps the main conversation first, and omits Snooze, Archive, Delete and Remove", () => {
    const { rows } = rowMenu(rowOf({ isDefault: true }), ctx());
    expect(rows.find(row => row.label === "Pin to top")?.off).toBe(MAIN_STAYS);
    expect(rows.some(row => row.label === "Snooze" || row.label === "Archive" || row.label.startsWith("Delete") || row.label.startsWith("Remove"))).toBe(false);
    expect(rows.at(-1)?.label).toBe("Mark done");
  });
  it("greys Open in its own window when this window can't, and hides Pause until Technical", () => {
    const { rows } = rowMenu(rowOf({}), ctx({ ownWindowOff: "Only in the desktop app." }));
    expect(rows.find(row => row.label === "Open in its own window")?.off).toBe("Only in the desktop app.");
    expect(rows.some(row => row.label === "Pause")).toBe(false);
    expect(rowMenu(rowOf({}), ctx({ technical: true })).rows.find(row => row.label === "Pause")?.off).toBe("Pause comes in a later update.");
  });
  it("asks for a first message before acting on a conversation that doesn't exist yet", () => {
    const { rows } = rowMenu(rowOf({ thread: null }), ctx());
    expect(rows.find(row => row.label === "Pin to top")?.off).toBe(FIRST_MESSAGE);
    expect(rows.find(row => row.label === "Mark as unread")?.off).toBe(FIRST_MESSAGE);
    expect(rows.find(row => row.label === "Snooze")?.off).toBe(FIRST_MESSAGE);
    expect(rows.find(row => row.label === "Delete…")?.off).toBe(FIRST_MESSAGE);
  });
  it("gives a pinned face the same menu, with Unpin and Replace with a different Trunk…", () => {
    const c = ctx(), pinned = rowOf({ pinnedAt: 5 });
    const { tiles, rows } = rowMenu(pinned, c);
    expect(tiles).toEqual([]);
    const pinnedLabels = TRUNK_ROWS.map(label => label === "Pin to top" ? "Unpin" : label);
    pinnedLabels.splice(pinnedLabels.length - 2, 0, REPLACE_PIN);
    expect(rows.map(row => row.label)).toEqual(pinnedLabels);
    const replace = rows.find(row => row.label === REPLACE_PIN)!;
    expect(replace.need).toEqual(["sessions.patch", "sessions.patchMany", "contacts.topics"]);
    expect(replace.gap).toBe(true);
    expect(rows.find(row => row.label === "Delete…")?.gap).toBeUndefined();
    replace.onSelect?.();
    expect(c.replacePin).toHaveBeenCalledWith(pinned);
    expect(rowMenu(rowOf({}), ctx()).rows.some(row => row.label === REPLACE_PIN)).toBe(false);
  });
  it("keeps the default's pin in place: its Replace says why", () => {
    const { rows } = rowMenu(rowOf({ pinnedAt: 5, isDefault: true }), ctx());
    expect(rows.find(row => row.label === REPLACE_PIN)?.off).toBe(DEFAULT_FIRST);
  });
  it("archives a group through its room, and leaves the Trunk-only rows off", () => {
    const c = ctx();
    const { rows } = rowMenu(rowOf({ id: "room:r1", kind: "group", name: "Quotes", roomId: "r1" } as Partial<Contact>), c);
    rows.find(row => row.label === "Archive")?.onSelect?.();
    expect(c.archiveRoom).toHaveBeenCalled();
    expect(rows.some(row => row.label.startsWith("New conversation with") || row.label === "Pause" || row.label === "Remove…")).toBe(false);
  });
  it("archives and restores a conversation, and a grafted row, and greys only a Trunk", () => {
    const c = ctx();
    const chat = rowOf({ id: "chat:side", kind: "chatGroup", name: "Side", threadKey: "agent:quill:side" });
    const archive = rowMenu(chat, c).rows.find(row => row.label === "Archive")!;
    expect(archive.off).toBeUndefined();
    archive.onSelect?.();
    expect(c.actions.archive).toHaveBeenCalledWith(expect.objectContaining({ key: "agent:quill:side" }));
    const restore = rowMenu(rowOf({ id: "chat:side", kind: "chatGroup", name: "Side", threadKey: "agent:quill:side", archivedAt: 9 }), c).rows.find(row => row.label === "Restore")!;
    expect(restore.off).toBeUndefined();
    restore.onSelect?.();
    expect(c.actions.restore).toHaveBeenCalledWith(expect.objectContaining({ key: "agent:quill:side" }));
    const grafted = rowMenu(rowOf({ id: "a2a:studio", kind: "outside", name: "Studio", threadKey: "a2a:studio" }), c).rows.find(row => row.label === "Archive")!;
    expect(grafted.off).toBeUndefined();
    grafted.onSelect?.();
    expect(c.actions.archive).toHaveBeenCalledTimes(2);
    expect(rowMenu(rowOf({ archivedAt: 4 }), ctx()).rows.some(row => row.label === "Restore")).toBe(false);
    expect(rowMenu(rowOf({ archivedAt: 4 }), ctx({ technical: true })).rows.find(row => row.label === "Restore")?.off).toBe("Restore comes in a later update.");
  });
  it("hides unfinished Coming rows at Advanced, and shows them greyed at Technical in the preview's places", () => {
    const advanced = rowMenu(rowOf({}), ctx({ advanced: true })).rows;
    for (const label of ["Hide from Involving me", "Open folder in", "Assign to…", "Icon and colour", "Archive", "Pause"]) {
      expect(advanced.some(row => row.label === label), label).toBe(false);
    }
    expect(advanced.find(row => row.label === "Tidy up…")?.submenu?.map(entry => entry.label)).toEqual(["Tidy up this conversation", "Keep only the last 400 lines…"]);
    const { rows } = rowMenu(rowOf({}), ctx({ advanced: true, technical: true }));
    const labels = rows.map(row => row.label);
    expect(labels.indexOf("Hide from Involving me")).toBe(labels.indexOf("Mark as unread") + 1);
    expect(labels.indexOf("Open folder in")).toBe(labels.indexOf("Open in its own window") + 1);
    expect(labels.indexOf("Assign to…")).toBe(labels.indexOf("Move to project") + 1);
    expect(labels.indexOf("Icon and colour")).toBe(labels.indexOf("Assign to…") + 1);
    for (const label of ["Hide from Involving me", "Open folder in", "Assign to…", "Icon and colour"]) {
      expect(rows.find(row => row.label === label)?.off).toBe(`${label} comes in a later update.`);
    }
  });
});

describe("row ••• menu hints", () => {
  it("are short plain words with no 'default' jargon, so they fit a tile in one or two lines", () => {
    for (const hint of [DEFAULT_AWAKE, DEFAULT_LISTED, TRUNK_LISTED, DEFAULT_FIRST]) {
      expect(hint).not.toMatch(/default/i);
      expect(hint.length).toBeLessThanOrEqual(16);
    }
  });
});
