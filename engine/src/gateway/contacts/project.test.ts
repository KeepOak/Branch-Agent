import { describe, expect, it } from "vitest";
import type { SessionEntrySummary } from "../../config/sessions/session-accessor.js";
import { contactIdForSession, projectContacts } from "./project.js";

function row(
  sessionKey: string,
  changes: Partial<SessionEntrySummary["entry"]> = {},
): SessionEntrySummary {
  return {
    sessionKey,
    entry: { sessionId: `generation-${sessionKey}`, updatedAt: 100, ...changes },
  };
}

describe("contact projection", () => {
  it("keeps the canonical main key as a Trunk row target across reset generations", () => {
    const sessions = [
      row("agent:scout:main", {
        sessionId: "second",
        previousSessionId: "first",
        lastActivityAt: 20,
      }),
    ];
    const first = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions,
    });
    expect(first.contacts[0]?.threadKey).toBe("agent:scout:main");
    sessions[0]!.entry.sessionId = "third";
    expect(
      projectContacts({
        agents: [{ id: "scout", name: "Scout" }],
        defaultAgentId: "scout",
        sessions,
      }).contacts[0]?.threadKey,
    ).toBe("agent:scout:main");
    expect(
      projectContacts({
        agents: [{ id: "scout", name: "Scout" }],
        defaultAgentId: "scout",
        mainKey: "home",
        sessions: [row("agent:scout:home")],
      }).contacts[0]?.threadKey,
    ).toBe("agent:scout:home");
  });

  it.each([
    ["main", row("agent:scout:main"), "trunk:scout"],
    ["outside DM", row("agent:scout:telegram:direct:alice"), "trunk:scout"],
    ["window topic", row("agent:scout:window:job"), "trunk:scout"],
    ["background topic", row("agent:scout:background:job"), "trunk:scout"],
    ["subagent", row("agent:scout:subagent:one", { spawnedBy: "agent:scout:main" }), undefined],
    ["cron", row("agent:scout:cron:run:one"), undefined],
    ["group", row("agent:scout:telegram:group:123"), "chat:agent:scout:telegram:group:123"],
    [
      "group topic",
      row("agent:scout:telegram:group:123:topic:7"),
      "chat:agent:scout:telegram:group:123",
    ],
    ["room member", row("agent:scout:room:123"), undefined],
    ["A2A context", row("agent:scout:a2a:remote:direct:peer:context"), "a2a:peer"],
  ])("classifies %s by key", (_name, session, expected) => {
    expect(contactIdForSession(session as SessionEntrySummary)).toBe(expected);
  });

  it("rolls up topics and archives removed Trunks without retargeting their row", () => {
    const sessions = [
      row("agent:gone:main", { lastReadAt: 200, updatedAt: 100 }),
      row("agent:gone:window:task", { lastReadAt: 50, lastActivityAt: 150, label: "Task" }),
    ];
    const { contacts, topics } = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions,
    });
    const gone = contacts.find((contact) => contact.id === "trunk:gone");
    expect(gone).toMatchObject({
      threadKey: "agent:gone:main",
      archivedAt: 100,
      unreadTopics: 1,
      topicCount: 1,
    });
    expect(topics).toContainEqual(
      expect.objectContaining({
        key: "agent:gone:window:task",
        contactId: "trunk:gone",
        title: "Task",
        labelled: true,
      }),
    );
  });

  it("keeps a thread pin separate from its parent contact pin", () => {
    const result = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions: [row("agent:scout:window:task", { pinnedAt: 150 })],
    });
    expect(result.contacts[0]?.pinnedAt).toBeUndefined();
    expect(result.topics[0]?.pinnedAt).toBe(150);
    const mainPinned = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions: [row("agent:scout:main", { pinnedAt: 200 }), row("agent:scout:window:task", { pinnedAt: 150 })],
    });
    expect(mainPinned.contacts[0]?.pinnedAt).toBe(200);
  });

  it("previews a topic update card in the main thread when that topic is newer", () => {
    const main = row("agent:scout:main", { lastActivityAt: 100 });
    const child = row("agent:scout:window:plan", {
      createdAt: 70,
      lastActivityAt: 150,
      contactAnchor: { threadKey: "agent:scout:main", afterMessageId: "opening" },
    });
    const result = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions: [main, child],
      previews: new Map([
        [main.sessionKey, "Hello"],
        [child.sessionKey, "Done"],
      ]),
      titles: new Map([[child.sessionKey, "Plan the trip"]]),
    });
    expect(result.contacts[0]?.preview).toEqual({
      kind: "topic",
      topicKey: child.sessionKey,
      title: "Plan the trip",
      text: "Done",
      at: 150,
    });
    expect(result.topics[0]?.anchor).toEqual({
      threadKey: main.sessionKey,
      afterMessageId: "opening",
      at: 70,
    });
  });

  it("keeps chat-app group topics under one group contact", () => {
    const root = row("agent:scout:telegram:group:123", {
      subject: "Project room",
      lastActivityAt: 100,
    });
    const topic = row("agent:scout:telegram:group:123:topic:7", { lastActivityAt: 200 });
    const result = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions: [root, topic],
    });
    const group = result.contacts.find((contact) => contact.id === `chat:${root.sessionKey}`);
    expect(group).toMatchObject({
      name: "Project room",
      threadKey: root.sessionKey,
      topicCount: 1,
    });
    expect(result.topics).toContainEqual(
      expect.objectContaining({ key: topic.sessionKey, contactId: group?.id }),
    );
  });

  it("projects configured outside peers and keeps each context in its own topic", () => {
    const first = row("agent:scout:a2a:remote:direct:peer:context-a", {
      createdAt: 10,
      lastActivityAt: 20,
      pinnedAt: 15,
    });
    const second = row("agent:scout:a2a:remote:direct:peer:context-b", {
      createdAt: 30,
      lastActivityAt: 40,
    });
    const result = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions: [first, second],
      outsidePeers: [
        {
          name: "peer",
          where: "peer.example",
          card: {
            name: "Outside",
            description: "Research",
            skills: [{ name: "Search" }],
            fetchedAt: 50,
          },
        },
        { name: "idle", where: null },
      ],
      previews: new Map([[first.sessionKey, "First"]]),
    });
    expect(result.contacts.find((contact) => contact.id === "a2a:peer")).toMatchObject({
      kind: "outside",
      name: "Outside",
      threadKey: "a2a:peer",
      preview: { kind: "message", text: "", at: 0 },
      topicCount: 2,
    });
    expect(result.contacts.find((contact) => contact.id === "a2a:peer")?.pinnedAt).toBeUndefined();
    expect(result.topics.find((topic) => topic.key === first.sessionKey)?.pinnedAt).toBe(15);
    expect(result.topics).toContainEqual(
      expect.objectContaining({ key: first.sessionKey, contactId: "a2a:peer" }),
    );
    expect(result.topics).toContainEqual(
      expect.objectContaining({ key: second.sessionKey, contactId: "a2a:peer" }),
    );
    expect(result.contacts.find((contact) => contact.id === "a2a:idle")).toMatchObject({
      topicCount: 0,
    });
    expect(result.contacts.find((contact) => contact.id === "trunk:scout")?.topicCount).toBe(0);
  });

  it("takes working from the live run registry, not a writer id left by a restart", () => {
    const sessions = [
      row("agent:scout:main", { activeWriterRunId: "stale-run" }),
      row("agent:scout:window:job", { activeWriterRunId: "stale-run-2" }),
      row("agent:oak:main"),
    ];
    const live = new Set(["agent:oak:main"]);
    const projected = projectContacts({
      agents: [
        { id: "scout", name: "Scout" },
        { id: "oak", name: "Oak" },
      ],
      defaultAgentId: "scout",
      sessions,
      isWorking: (candidate) => live.has(candidate.sessionKey),
    });
    const working = Object.fromEntries(projected.contacts.map((c) => [c.id, c.working]));
    expect(working).toEqual({ "trunk:scout": false, "trunk:oak": true });
    expect(projected.topics.find((t) => t.key === "agent:scout:window:job")?.status).toBe("active");
  });

  it("does not mark a conversation unread when restart recovery only touched it", () => {
    const projected = projectContacts({
      agents: [{ id: "scout", name: "Scout" }],
      defaultAgentId: "scout",
      sessions: [
        // Restart recovery rewrote the row (updatedAt) after the person read it.
        row("agent:scout:main", { lastReadAt: 100, lastActivityAt: 90, updatedAt: 500 }),
        row("agent:scout:window:replied", { lastReadAt: 100, lastActivityAt: 400 }),
        row("agent:scout:window:asked", { lastReadAt: 100, lastInteractionAt: 300 }),
      ],
    });
    expect(projected.contacts[0]).toMatchObject({ threadUnread: false, unreadTopics: 2 });
  });
});
