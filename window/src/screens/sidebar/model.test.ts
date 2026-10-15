import { describe, expect, it } from "vitest";
import type { Contact } from "../../shell/contacts-model";
import { buildSections, contactRows, folderCount, personRows, rowTime, type SideRow } from "./model";

const contact = (over: Partial<Contact> & Pick<Contact, "id" | "kind" | "name">): Contact => ({
  threadKey: `agent:${over.id}:main`, isDefault: false, lastActivityAt: 0, preview: { kind: "message", text: "", at: 0 },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, thread: null, ...over,
} as Contact);

const contacts: Contact[] = [
  contact({ id: "trunk:sapling", kind: "trunk", name: "Sapling", isDefault: true, pinnedAt: 1, preview: { kind: "message", text: "Morning", at: 50 } }),
  contact({ id: "trunk:ledger", kind: "trunk", name: "Ledger", threadUnread: true, preview: { kind: "topic", topicKey: "t", title: "Inbox sweep", text: "Stopped", at: 90 } }),
  contact({ id: "trunk:ada", kind: "trunk", name: "Ada", preview: { kind: "message", text: "Lisbon fares", at: 70 } }),
  contact({ id: "room:r1", kind: "group", name: "Supplier quotes", roomId: "r1", preview: { kind: "message", text: "Group", at: 20 } } as Partial<Contact> & Pick<Contact, "id" | "kind" | "name">),
  contact({ id: "a2a:cc", kind: "outside", name: "Claude Code", needsYou: true, preview: { kind: "message", text: "Clicking through", at: 80 } }),
  contact({ id: "trunk:old", kind: "trunk", name: "Old", archivedAt: 5 }),
];
const rows = (): SideRow[] => [
  ...contactRows(contacts, new Map([["agent:trunk:ada:main", 1]]), () => [{ name: "Ledger", kind: "trunk" }, { name: "Ada", kind: "trunk" }]),
  ...personRows([{ id: "me", name: "Taofik" }, { id: "dana", name: "Dana Okafor", role: "member" }], "me"),
];

describe("sidebar model", () => {
  it("splits contacts into Pinned, Trunks, People, Groups, Grafted and Archived", () => {
    const s = buildSections(rows(), "all", "");
    expect(s.pinned.map(row => row.name)).toEqual(["Sapling"]);
    expect(s.trunks.map(row => row.name)).toEqual(["Ledger", "Ada"]);
    expect(s.people.map(row => row.name)).toEqual(["Dana Okafor"]);
    expect(s.groups.map(row => row.name)).toEqual(["Supplier quotes"]);
    expect(s.grafted.map(row => row.name)).toEqual(["Claude Code"]);
    expect(s.archived.map(row => row.name)).toEqual(["Old"]);
  });
  it("reads previews, roles, waiting and group members from the engine's contact", () => {
    const all = rows();
    const ledger = all.find(row => row.name === "Ledger")!;
    expect(ledger).toMatchObject({ preview: "Inbox sweep: Stopped", unread: true, role: "Trunk", key: "agent:trunk:ledger:main" });
    expect(all.find(row => row.name === "Sapling")).toMatchObject({ role: "Chief of Staff", isDefault: true, pinned: true });
    expect(all.find(row => row.name === "Ada")?.waiting).toBe(true);
    expect(all.find(row => row.name === "Claude Code")).toMatchObject({ kind: "grafted", role: "Grafted", waiting: true });
    expect(all.find(row => row.kind === "group")).toMatchObject({ preview: "", members: [{ name: "Ledger", kind: "trunk" }, { name: "Ada", kind: "trunk" }] });
    expect(all.find(row => row.kind === "person")).toMatchObject({ key: null, role: "Member" });
  });
  it("narrows by folder and search, and counts what is unread in each folder", () => {
    const all = rows();
    expect(buildSections(all, "unread", "").trunks.map(row => row.name)).toEqual(["Ledger", "Ada"]);
    expect(buildSections(all, "groups", "").trunks).toEqual([]);
    expect(buildSections(all, "all", "lisbon").trunks.map(row => row.name)).toEqual(["Ada"]);
    expect(folderCount(all, "unread")).toBe(3);
    expect(folderCount(all, "trunks")).toBe(2);
    expect(folderCount(all, "all")).toBe(0);
  });
  it("keeps every section empty with no data", () => {
    expect(buildSections([], "all", "")).toEqual({ pinned: [], trunks: [], people: [], groups: [], grafted: [], archived: [] });
    expect(personRows([], null)).toEqual([]);
  });
  it("words a row's time like the preview", () => {
    const now = new Date(2026, 9, 12, 12, 0).getTime();
    expect(rowTime(now - 10_000, now)).toBe("now");
    expect(rowTime(new Date(2026, 9, 11, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(rowTime(0, now)).toBe("");
  });
});
