// A failing turn, in the order the engine really sends it: the lifecycle `error` event comes first, the
// window reads `chat.history` before the engine has written the "couldn't be completed" receipt, and only
// afterwards does the engine persist it (session-lifecycle-state.ts → recordGatewaySessionRunFailure) and
// announce it with `session.message` / `sessions.changed`, while the `chat` error terminal can come late too.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  transcript: [] as Record<string, unknown>[],
  historyReads: 0,
  historyFailures: 0,
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      switch (method) {
        case "chat.history":
          fake.historyReads += 1;
          if (fake.historyFailures-- > 0) throw new Error("Agent builder-oak has not completed startup inspection and preparation; run branch doctor --fix");
          return { messages: fake.transcript.map((m) => ({ ...m })) };
        case "chat.send":
          fake.transcript.push({ role: "user", content: String(params?.message ?? ""), timestamp: 1 });
          return { runId: "r1" };
        case "agents.list":
          return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
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

import { SaplingSession } from "./session";

const KEY = "agent:main:main";
const RECEIPT = "Your request couldn't be completed: provider exploded";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emit = async (event: string, payload: unknown) => {
  fake.options?.onEvent({ event, payload });
  await settle();
};

async function failTurnBeforeReceipt(): Promise<SaplingSession> {
  const session = new SaplingSession("ws://fake", undefined);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  await session.send("hello");
  await emit("agent", { runId: "r1", seq: 1, stream: "lifecycle", ts: 1, sessionKey: KEY, data: { phase: "start" } });
  // The early terminal event: the window reads history now, and the receipt is not there yet.
  await emit("agent", { runId: "r1", seq: 2, stream: "lifecycle", ts: 2, sessionKey: KEY, data: { phase: "error", error: "provider exploded" } });
  return session;
}

/** The engine persists the receipt (recordGatewaySessionRunFailure). */
function persistReceipt(): void {
  fake.transcript.push({ role: "custom", customType: "run-failed-before-reply", display: true, content: RECEIPT, timestamp: 3 });
}

const errorBlocks = (session: SaplingSession) => session.getSnapshot().history.filter((b) => b.kind === "error");

afterEach(() => {
  fake.options = null;
  fake.transcript = [];
  fake.historyReads = 0;
  fake.historyFailures = 0;
});

describe("a failing turn's error receipt reaches the thread after it is persisted", () => {
  it("retries a temporary preparation refusal and clears it when history becomes available", async () => {
    fake.historyFailures = 1;
    const session = new SaplingSession("ws://fake", undefined);
    session.start();
    fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
    await vi.waitFor(() => expect(session.getSnapshot().error).toContain("startup inspection"));
    await vi.waitFor(() => expect(session.getSnapshot().error).toBeNull(), { timeout: 5_000 });
    expect(fake.historyReads).toBeGreaterThanOrEqual(2);
    session.stop();
  });

  it("ends a persistent startup refusal with one plain message after the retry cap", async () => {
    vi.useFakeTimers();
    try {
      fake.historyFailures = 1_000;
      const session = new SaplingSession("ws://fake", undefined);
      session.start();
      fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getSnapshot().error).toContain("startup inspection");
      await vi.advanceTimersByTimeAsync(120_001);
      expect(session.getSnapshot().error).toBe("Main is still starting up. Try again in a minute.");
      const reads = fake.historyReads;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fake.historyReads).toBe(reads);
      session.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Couldn't finish once the engine announces the persisted receipt after the early lifecycle error", async () => {
    const session = await failTurnBeforeReceipt();
    const readsAfterEarlyTerminal = fake.historyReads;
    expect(errorBlocks(session)).toEqual([]);
    expect(session.getSnapshot().liveRunId).toBeNull();

    await emit("sessions.changed", { sessionKey: KEY, phase: "error", runId: "r1", ts: 4 });
    persistReceipt();
    await emit("session.message", { sessionKey: KEY, message: { role: "custom", customType: "run-failed-before-reply" } });
    await emit("chat", { runId: "r1", sessionKey: KEY, state: "error", errorMessage: "provider exploded" });

    expect(fake.historyReads).toBeGreaterThan(readsAfterEarlyTerminal);
    expect(errorBlocks(session)).toMatchObject([{ kind: "error", message: RECEIPT }]);
  });

  it.each([
    ["session.message", { sessionKey: KEY, message: { role: "custom" } }],
    ["sessions.changed", { sessionKey: KEY, phase: "message", ts: 5 }],
    ["chat", { runId: "r1", sessionKey: KEY, state: "error", errorMessage: "provider exploded" }],
  ])("re-reads history on a later %s alone", async (event, payload) => {
    const session = await failTurnBeforeReceipt();
    persistReceipt();
    await emit(event, payload);
    expect(errorBlocks(session)).toMatchObject([{ kind: "error", message: RECEIPT }]);
  });

  it("ignores another conversation's session events", async () => {
    const session = await failTurnBeforeReceipt();
    const reads = fake.historyReads;
    persistReceipt();
    await emit("session.message", { sessionKey: "agent:main:other", message: { role: "custom" } });
    await emit("sessions.changed", { sessionKey: "agent:main:other", phase: "message", ts: 5 });
    expect(fake.historyReads).toBe(reads);
    expect(errorBlocks(session)).toEqual([]);
  });
});
