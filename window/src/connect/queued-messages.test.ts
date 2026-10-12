// While a Trunk's turn runs, a message waits in the engine's queue (chat.history pendingInputs). The open conversation
// shows it at once, marked "queued"; when a turn picks it up it becomes "delivered" until the history has it in place.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  transcript: [] as Record<string, unknown>[],
  pending: [] as Record<string, unknown>[],
  inFlight: null as string | null,
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
          return {
            messages: fake.transcript.map((m) => ({ ...m })),
            pendingInputs: { items: fake.pending.map((p) => ({ ...p })), total: fake.pending.length },
            ...(fake.inFlight ? { inFlightRun: { runId: fake.inFlight, text: "" } } : {}),
          };
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

import { mergeQueued, SaplingSession } from "./session";

const KEY = "agent:lead:room:room-1";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emit = async (event: string, payload: unknown) => {
  fake.options?.onEvent({ event, payload });
  await settle();
};
const claudePost = {
  id: "pending:p1",
  state: "queued",
  acceptedAt: 1,
  message: {
    role: "user",
    content: "Ship it",
    timestamp: 1,
    __branch: {
      id: "pending:p1",
      senderId: "claude-code-a1b2c3",
      senderName: "Claude Code",
      senderIdentity: { type: "observation", id: "claude-code-a1b2c3", pluginId: "a2a", accountId: "mcp", senderKind: "bot" },
    },
  },
};

afterEach(() => {
  fake.options = null;
  fake.transcript = [];
  fake.pending = [];
  fake.inFlight = null;
});

describe("messages waiting for a turn", () => {
  it("turns the engine's waiting inputs into queued user blocks and keeps a picked-up one as delivered", () => {
    const queued = mergeQueued([], { items: [claudePost] }, KEY, false);
    expect(queued).toMatchObject([{ key: "queued:pending:p1", state: "queued", block: { kind: "user", text: "Ship it" } }]);
    expect(queued[0]!.block.meta?.sender).toMatchObject({ kind: "agent" });
    expect(mergeQueued(queued, { items: [] }, KEY, false)).toMatchObject([{ key: "queued:pending:p1", state: "delivered" }]);
    expect(mergeQueued(queued, { items: [] }, KEY, true)).toEqual([]);
    expect(mergeQueued([], { items: [{ ...claudePost, state: "cancelled" }] }, KEY, false)).toEqual([]);
  });

  it("shows a post that arrives while a turn runs at once, then marks it delivered when a turn takes it", async () => {
    fake.inFlight = "run-1";
    const session = new SaplingSession("ws://fake", undefined, KEY);
    session.start();
    fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
    await vi.waitFor(() => expect(session.getSnapshot().liveRunId).toBe("run-1"));

    fake.pending = [claudePost];
    await emit("sessions.changed", { sessionKey: KEY, phase: "message", ts: 2 });
    await vi.waitFor(() => expect(session.getSnapshot().queued.map((q) => q.state)).toEqual(["queued"]));
    expect(session.getSnapshot().history).toEqual([]);

    // A new turn starts and takes the waiting post out of the queue.
    fake.pending = [];
    await emit("agent", { runId: "run-2", seq: 1, stream: "lifecycle", ts: 3, sessionKey: KEY, data: { phase: "start" } });
    await vi.waitFor(() => expect(session.getSnapshot().queued.map((q) => q.state)).toEqual(["delivered"]));
    session.stop();
  });
});
