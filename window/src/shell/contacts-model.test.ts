import type { Contact as GatewayContact } from "@branch/gateway-protocol";
import { describe, expect, it, vi } from "vitest";
import { projectConversation } from "../connect/conversations";
import { buildContactSections, contactRow, contactRowsFor, fallbackTrunkContacts, listContactTopics, markAllThreadsRead, markContactRead, markThreadsRead, projectContact } from "./contacts-model";
import { DEFAULT_PREFS } from "./list-model";
import { contactAlert, contactAlertTarget } from "./notify";

const row = (key: string, extra: Record<string, unknown> = {}) => projectConversation({ key, updatedAt: 10, lastMessagePreview: key, ...extra }, null);
const raw = (id: string, extra: Partial<GatewayContact> = {}): GatewayContact => ({
  id: `trunk:${id}`, kind: "trunk", name: id, threadKey: `agent:${id}:main`, isDefault: id === "oak",
  lastActivityAt: 10, preview: { kind: "message", text: "Main reply", at: 10 },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});

describe("Gateway contact projection", () => {
  it("does not fall back to Trunks when contacts.list has loaded an empty roster", () => {
    const trunk = { id: "main", name: "Main", isDefault: true };
    expect(contactRowsFor([], true, [trunk], [], "agent:main:main", true)).toEqual([]);
    expect(contactRowsFor([], false, [trunk], [], "agent:main:main", false)).toEqual([]);
    expect(contactRowsFor([], false, [trunk], [], "agent:main:main", true).map((c) => c.id)).toEqual(["trunk:main"]);
    expect(contactRowsFor([], true, [], [], "agent:main:main", true, trunk).map((c) => c.id)).toEqual(["trunk:main"]);
  });
  it("shows each Trunk as a contact before its first conversation or contacts projection", () => {
    const fallback = fallbackTrunkContacts([
      { id: "main", name: "Main", isDefault: true },
      { id: "scout", name: "Scout", isDefault: false },
    ], [], "agent:main:main");
    expect(buildContactSections(projectContact(fallback, []), DEFAULT_PREFS, 100).find((s) => s.id === "recent")?.rows.map((r) => r.title)).toEqual(["Main", "Scout"]);
    expect(fallback.map((c) => c.threadKey)).toEqual(["agent:main:main", "agent:scout:main"]);
  });
  it("shows a joined computer with its Trunks' character faces", () => {
    const computer = raw("nas", {
      id: "a2a:branch-nas", kind: "outside", name: "NAS-linux", threadKey: "a2a:branch-nas",
      face: { trunks: [{ name: "Tester", avatar: "branch:ember" }, { name: "Scout", avatar: "branch:sorrel" }] },
    });
    expect(contactRow(projectContact([computer], [])[0]).roomPicks).toEqual([
      { kind: "trunk", name: "Tester", avatar: "branch:ember" },
      { kind: "trunk", name: "Scout", avatar: "branch:sorrel" },
    ]);
  });
  it("keeps the canonical key through a session id rotation", () => {
    const source = [row("agent:oak:main", { sessionId: "rotated" })];
    expect(contactRow(projectContact([raw("oak")], source)[0]).key).toBe("agent:oak:main");
    source[0] = row("agent:oak:main", { sessionId: "next" });
    expect(contactRow(projectContact([raw("oak")], source)[0]).key).toBe("agent:oak:main");
  });

  it("orders the default Trunk among recent contacts unless pinned", () => {
    const contacts = projectContact([raw("oak"), raw("elm", { isDefault: false, pinnedAt: 8 }), raw("ash", { isDefault: false, lastActivityAt: 20 })], []);
    expect(contactRow(contacts.find((c) => c.isDefault)!).key).toBe("agent:oak:main");
    expect(buildContactSections(contacts, DEFAULT_PREFS, 100).map((s) => [s.label, s.rows.map((r) => r.key)])).toEqual([
      ["Pinned", ["agent:elm:main"]], ["Recent", ["agent:ash:main", "agent:oak:main"]],
    ]);
  });

  it("rolls up topic unread without marking the thread unread", () => {
    const [contact] = projectContact([raw("oak", { unreadTopics: 2, topicCount: 3 })], [row("agent:oak:main", { unread: false })]);
    expect(contactRow(contact)).toMatchObject({ key: "agent:oak:main", unread: true });
    expect(contact.threadUnread).toBe(false);
  });

  it("keeps the unread dot when mute suppresses ordinary alerts", () => {
    const [contact] = projectContact([raw("oak", { unreadTopics: 1, preview: { kind: "topic", topicKey: "agent:oak:topic", title: "Research", text: "Reply", at: 20 } })], []);
    expect(contactRow(contact).unread).toBe(true);
    expect(contactAlert(contact, true)).toBeNull();
    expect(contactAlert({ ...contact, needsYou: true }, true)?.title).toBe("oak");
    expect(contactAlert({ ...contact, preview: { ...contact.preview, text: "@owner please review" } }, true)?.body).toContain("in Research");
    expect(contactAlertTarget(contact)).toBe("agent:oak:topic");
    expect(contactAlertTarget(projectContact([raw("oak")], [])[0])).toBe("agent:oak:main");
  });

  it("uses the Gateway topic preview and its activity time on the canonical row", () => {
    const [contact] = projectContact([raw("oak", {
      lastActivityAt: 50, preview: { kind: "topic", topicKey: "agent:oak:topic", title: "Research", text: "Topic reply", at: 50 },
    })], [row("agent:oak:main", { updatedAt: 10, lastMessagePreview: "Main reply" })]);
    expect(contactRow(contact)).toMatchObject({ key: "agent:oak:main", updatedAt: 50, preview: "Research: Topic reply" });
  });

  it("marks all unread under a contact with one contacts.markRead request", async () => {
    const [contact] = projectContact([raw("oak", { threadUnread: true, unreadTopics: 2 })], []);
    const request = vi.fn(async () => ({ updated: 3 }));
    expect(await markContactRead(contact, request)).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith("contacts.markRead", { contactId: "trunk:oak" });
    expect(await markContactRead(projectContact([raw("oak")], [])[0], request)).toBe(false);
  });

  it("reads every topic page for contact actions", async () => {
    const request = vi.fn(async (_method: string, params: unknown) => ({ topics: [{ key: (params as { cursor?: string }).cursor ?? "first" }], ...(!(params as { cursor?: string }).cursor ? { nextCursor: "second" } : {}) }));
    expect((await listContactTopics("trunk:oak", request)).map((topic) => topic.key)).toEqual(["first", "second"]);
    expect(request).toHaveBeenNthCalledWith(2, "contacts.topics", { contactId: "trunk:oak", limit: 200, cursor: "second" });
  });
});

describe("bulk read requests", () => {
  it("marks every thread with one request that carries a fresh mutation id", async () => {
    const request = vi.fn(async (_method: string, _params: unknown) => ({ applied: true, readThroughMs: 1 }));
    await markAllThreadsRead(request);
    expect(request).toHaveBeenCalledExactlyOnceWith("contacts.markAllRead", { mutationId: expect.any(String) });
  });

  it("marks listed sessions in batches of 500, each batch with its own mutation id", async () => {
    const request = vi.fn(async (_method: string, _params: unknown) => ({ applied: true, readThroughMs: 1 }));
    await markThreadsRead(request, Array.from({ length: 1001 }, (_, i) => `agent:oak:thread-${i}`));
    const batches = request.mock.calls.map(([, params]) => (params as { sessionKeys: string[] }).sessionKeys.length);
    expect(batches).toEqual([500, 500, 1]);
    const ids = new Set(request.mock.calls.map(([, params]) => (params as { mutationId: string }).mutationId));
    expect(ids.size).toBe(3);
  });
});
