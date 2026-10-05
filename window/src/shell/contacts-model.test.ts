import { describe, expect, it } from "vitest";
import { projectConversation } from "../connect/conversations";
import { buildContactSections, contactIdFor, contactRow, markContactRead, projectContact } from "./contacts-model";
import { vi } from "vitest";
import { DEFAULT_PREFS } from "./list-model";

const row = (key: string, extra: Record<string, unknown> = {}) => projectConversation({ key, updatedAt: 10, lastMessagePreview: key, ...extra }, null);

describe("contact projection", () => {
  it("keeps the canonical key through a session id rotation", () => {
    const source = { trunks: [{ id: "oak", name: "Oak", isDefault: true }], defaultId: "oak", mainKey: "main", sessions: [row("agent:oak:main", { sessionId: "rotated" }), row("agent:oak:job", { sessionId: "other" })] };
    const contact = projectContact(source)[0];
    expect(contact.threadKey).toBe("agent:oak:main");
    expect(contactRow(contact).key).toBe("agent:oak:main");
    expect(contact.topicCount).toBe(1);
    source.sessions[0] = row("agent:oak:main", { sessionId: "next" });
    expect(projectContact(source)[0].threadKey).toBe("agent:oak:main");
  });

  it("classifies sessions without loose sidebar rows", () => {
    const samples: [string, Record<string, unknown>, string | null][] = [
      ["agent:oak:home", {}, "trunk:oak"],
      ["agent:oak:signal:direct:bob", {}, "trunk:oak"],
      ["agent:oak:window-1", {}, "trunk:oak"],
      ["agent:oak:background-1", {}, "trunk:oak"],
      ["agent:oak:helper", { spawnedBy: "agent:oak:window-1" }, null],
      ["agent:oak:cron:daily", {}, null],
      ["agent:oak:telegram:group:team", {}, "chat:agent:oak:telegram:group:team"],
      ["agent:oak:window-group", { participants: [{ identity: { type: "profile", id: "friend" } }] }, "chat:agent:oak:window-group"],
      ["agent:oak:room:r1", {}, null],
      ["agent:oak:a2a:v1:direct:peer:ctx", {}, "a2a:peer"],
    ];
    for (const [key, facts, expected] of samples) expect(contactIdFor(row(key, facts)), key).toBe(expected);
    const contacts = projectContact({ trunks: [], defaultId: null, mainKey: "home", sessions: [row("agent:oak:home"), row("agent:oak:window-1")] });
    expect(contacts[0]).toMatchObject({ id: "trunk:oak", archivedAt: 10, topicCount: 1 });
  });

  it("shows group and outside contacts without inventing a Trunk from their sessions", () => {
    const contacts = projectContact({
      trunks: [], defaultId: null, mainKey: "main",
      sessions: [
        row("agent:oak:telegram:group:team", { displayName: "Team" }),
        row("agent:elm:a2a:v1:direct:peer:one", { displayName: "Peer", unread: true }),
        row("agent:elm:a2a:v1:direct:peer:two", { unread: true }),
      ],
    });
    expect(contacts.map((contact) => contact.kind)).toEqual(["chatGroup", "outside"]);
    expect(contacts[1]).toMatchObject({ id: "a2a:peer", topicCount: 1, unreadTopics: 1, threadUnread: true });
  });

  it("shows default, pinned and recent contacts in that order", () => {
    const contacts = projectContact({
      trunks: [{ id: "oak", name: "Oak", isDefault: true }, { id: "elm", name: "Elm", isDefault: false }, { id: "ash", name: "Ash", isDefault: false }],
      defaultId: "oak", mainKey: "main", sessions: [row("agent:oak:main"), row("agent:elm:main", { pinned: true }), row("agent:ash:main", { updatedAt: 20 })],
    });
    expect(contactRow(contacts.find((c) => c.isDefault)!).key).toBe("agent:oak:main");
    expect(buildContactSections(contacts, DEFAULT_PREFS, 100).map((s) => [s.label, s.rows.map((r) => r.key)])).toEqual([
      ["Pinned", ["agent:elm:main"]], ["Recent", ["agent:ash:main"]],
    ]);
  });

  it("keeps row preview and timestamp on the opened thread while topics update", () => {
    const [contact] = projectContact({
      trunks: [{ id: "oak", name: "Oak", isDefault: true }], defaultId: "oak", mainKey: "main",
      sessions: [row("agent:oak:main", { updatedAt: 10, lastMessagePreview: "Main reply" }), row("agent:oak:topic", { updatedAt: 50, lastMessagePreview: "Topic reply", unread: true, hasActiveRun: true })],
    });
    expect(contact).toMatchObject({ lastActivityAt: 50, unreadTopics: 1, working: true, preview: { kind: "message", text: "Main reply", at: 10 } });
    expect(contactRow(contact)).toMatchObject({ key: "agent:oak:main", updatedAt: 10, preview: "Main reply", unread: true });
  });

  it("marks a contact's thread and unread topics through one patchMany call", async () => {
    const [contact] = projectContact({
      trunks: [{ id: "oak", name: "Oak", isDefault: true }], defaultId: "oak", mainKey: "main",
      sessions: [row("agent:oak:main", { unread: true, sessionId: "segment-2" }), row("agent:oak:topic", { unread: true }), row("agent:oak:read", { unread: false })],
    });
    const request = vi.fn(async () => ({}));
    expect(await markContactRead(contact, request)).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.patchMany", {
      targets: [{ key: "agent:oak:main", agentId: "oak", expectedSessionId: "segment-2" }, { key: "agent:oak:topic", agentId: "oak" }],
      patch: { unread: false },
    });
  });
});
