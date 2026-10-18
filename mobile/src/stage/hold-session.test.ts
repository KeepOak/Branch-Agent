import { pickHoldSession } from "./hold-session";
import { fixtureAgents, fixtureSessions } from "../testing/chatFixtures";

describe("pickHoldSession", () => {
  it("pauses the Trunk that is working, by its newest working chat", () => {
    expect(pickHoldSession({ sessions: fixtureSessions }, fixtureAgents)).toEqual({
      sessionKey: "agent:oak:main",
      agentId: "oak",
      name: "Oak",
    });
  });

  it("falls back to the newest shown chat when nothing is working", () => {
    const idle = [
      { key: "agent:main:main", agentId: "main", updatedAt: 20 },
      { key: "agent:oak:main", agentId: "oak", updatedAt: 10 },
      { key: "agent:main:archived", agentId: "main", archived: true, updatedAt: 99 },
      { key: "agent:oak:helper", agentId: "oak", spawnedBy: "agent:oak:main", updatedAt: 99 },
    ];
    expect(pickHoldSession({ sessions: idle }, fixtureAgents)).toEqual({
      sessionKey: "agent:main:main",
      agentId: "main",
      name: "Branch Agent",
    });
  });

  it("returns null when there are no shown chats", () => {
    expect(pickHoldSession({ sessions: [] })).toBeNull();
  });
});
