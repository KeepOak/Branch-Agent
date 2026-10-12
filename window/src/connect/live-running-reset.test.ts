// P46: after an engine restart or an in-place update the window reconnects to a new engine. The runs it
// mirrored are gone, so every hello clears them and chat.history's inFlightRun says what still runs.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  inFlightRun: null as Record<string, unknown> | null,
  historyGate: null as Promise<void> | null,
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
          await fake.historyGate;
          return { messages: [], ...(fake.inFlightRun ? { inFlightRun: fake.inFlightRun } : {}) };
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
const hello = () => ({ snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connect(): Promise<void> {
  fake.options?.onStatus({ phase: "connected", hello: hello() } as unknown as GatewayStatus);
  await settle();
}

async function liveSession(): Promise<SaplingSession> {
  const session = new SaplingSession("ws://fake", undefined);
  session.start();
  fake.inFlightRun = { runId: "old-run", text: "Working on it" };
  await connect();
  fake.options?.onEvent({ event: "agent", payload: { runId: "old-run", seq: 1, stream: "lifecycle", ts: 1, sessionKey: KEY, data: { phase: "start" } } });
  await settle();
  return session;
}

afterEach(() => {
  fake.options = null;
  fake.inFlightRun = null;
  fake.historyGate = null;
});

describe("every hello is a fresh run registry", () => {
  it("clears the open conversation's run on reconnect before the engine is read again", async () => {
    const session = await liveSession();
    expect(session.getSnapshot().liveRunId).toBe("old-run");
    expect(session.getSnapshot().live.length).toBeGreaterThan(0);
    let open!: () => void;
    fake.historyGate = new Promise((resolve) => { open = resolve; });
    fake.inFlightRun = null;
    fake.options?.onStatus({ phase: "connecting" });
    fake.options?.onStatus({ phase: "connected", hello: hello() } as unknown as GatewayStatus);
    // Cleared at once, while the new engine's history is still on its way.
    expect(session.getSnapshot().liveRunId).toBeNull();
    expect(session.getSnapshot().live).toEqual([]);
    open();
    await settle();
    expect(session.getSnapshot().liveRunId).toBeNull();
  });

  it("takes the run the new engine still has (a resumed one) from chat.history", async () => {
    const session = await liveSession();
    fake.inFlightRun = { runId: "resumed-run", text: "" };
    fake.options?.onStatus({ phase: "connecting" });
    await connect();
    expect(session.getSnapshot().liveRunId).toBe("resumed-run");
  });
});
