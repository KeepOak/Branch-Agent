// A group chat (engine rooms.*) is drawn from its lead Trunk's conversation `agent:<lead>:room:<roomId>`. A post by a
// Trunk or an outside agent through Graft (rooms.send) is announced as `rooms.event`; the open room conversation
// re-reads its history on it, so the post shows without a click or reload.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  transcript: [] as Record<string, unknown>[],
  historyReads: 0,
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    async request(method: string): Promise<unknown> {
      switch (method) {
        case "chat.history":
          fake.historyReads += 1;
          return { messages: fake.transcript.map((m) => ({ ...m })) };
        case "agents.list":
          return { agents: [{ id: "lead", name: "Lead" }], defaultId: "lead" };
        case "approval.history":
          return { items: [] };
        case "exec.approval.list":
          return [];
        default:
          return {};
      }
    }
  },
}));

import { roomIdOf, SaplingSession } from "./session";

const ROOM_KEY = "agent:lead:room:room-1";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: ROOM_KEY } }, auth: { scopes: [] }, policy: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emit = async (event: string, payload: unknown) => {
  fake.options?.onEvent({ event, payload });
  await settle();
};

async function openRoom(): Promise<SaplingSession> {
  const session = new SaplingSession("ws://fake", undefined, ROOM_KEY);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await vi.waitFor(() => expect(fake.historyReads).toBeGreaterThan(0));
  await settle();
  return session;
}

const userTexts = (session: SaplingSession) =>
  session
    .getSnapshot()
    .history.filter((b) => b.kind === "user")
    .map((b) => JSON.stringify(b));

afterEach(() => {
  fake.options = null;
  fake.transcript = [];
  fake.historyReads = 0;
});

describe("a group chat post shows in the open room without a reload", () => {
  it("reads the room id from the lead conversation's key", () => {
    expect(roomIdOf(ROOM_KEY)).toBe("room-1");
    expect(roomIdOf("agent:lead:main")).toBe("");
    expect(roomIdOf("agent:lead:room:room-1:thread:2")).toBe("");
  });

  it("re-reads the room's history when a post in it is announced", async () => {
    const session = await openRoom();
    expect(userTexts(session)).toEqual([]);
    fake.transcript.push({ role: "user", content: "Claude Code (outside agent) wrote in the group chat:\nShip it", timestamp: 2 });
    await emit("rooms.event", { roomId: "room-1", seq: 3, type: "message", from: "a2a:claude-code-a1b2c3", data: { text: "Ship it" } });
    await vi.waitFor(() => expect(userTexts(session).join("")).toContain("Ship it"));
    session.stop();
  });

  it("ignores posts in other group chats", async () => {
    const session = await openRoom();
    const reads = fake.historyReads;
    await emit("rooms.event", { roomId: "room-2", seq: 1, type: "message", from: "owner", data: { text: "elsewhere" } });
    await settle();
    expect(fake.historyReads).toBe(reads);
    session.stop();
  });
});
