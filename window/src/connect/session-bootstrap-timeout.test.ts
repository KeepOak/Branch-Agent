// A read the engine never answers must not leave the window connecting forever. The gateway client gives up on a
// request after its timeout (code CLIENT_TIMEOUT); the session then reads again after a short, growing pause.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  silentAgentReads: 0,
  agentReads: [] as Array<number | undefined>,
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    request(method: string, _params?: unknown, options?: { timeoutMs?: number }): Promise<unknown> {
      if (method !== "agents.list") return Promise.resolve(method === "exec.approval.list" ? [] : method === "approval.history" ? { items: [] } : { messages: [] });
      fake.agentReads.push(options?.timeoutMs);
      if (fake.silentAgentReads > 0) {
        fake.silentAgentReads -= 1;
        // The request never answers. Only a timeout ends it, as in the gateway client; without one it hangs for good.
        if (options?.timeoutMs === undefined) return new Promise(() => {});
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(Object.assign(new Error("gateway request timed out"), { code: "CLIENT_TIMEOUT" })), options.timeoutMs);
        });
      }
      return Promise.resolve({ agents: [{ id: "main", name: "Main" }], defaultId: "main" });
    }
  },
}));

import { SaplingSession } from "./session";

const KEY = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
const connected = { phase: "connected", hello } as unknown as GatewayStatus;

let session: SaplingSession | undefined;
afterEach(() => {
  session?.stop();
  session = undefined;
  vi.useRealTimers();
  fake.silentAgentReads = 0;
  fake.agentReads = [];
});

describe("bootstrap reads that never answer", () => {
  it("gives a silent read a timeout, reads again, and connects", async () => {
    vi.useFakeTimers();
    fake.silentAgentReads = 1;
    session = new SaplingSession("ws://fake", undefined);
    session.start();
    fake.options?.onStatus(connected);
    await vi.advanceTimersByTimeAsync(0);

    // Still waiting on the silent read: the window stays connecting, with no error shown.
    expect(session.getSnapshot().status.phase).toBe("connecting");
    expect(session.getSnapshot().error).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fake.agentReads[0]).toBe(15_000);
    expect(fake.agentReads).toHaveLength(2);
    expect(session.getSnapshot().status.phase).toBe("connected");
    expect(session.getSnapshot().error).toBeNull();
  });

  it("backs off between tries when reads keep timing out, then connects", async () => {
    vi.useFakeTimers();
    fake.silentAgentReads = 3;
    session = new SaplingSession("ws://fake", undefined);
    session.start();
    fake.options?.onStatus(connected);
    await vi.advanceTimersByTimeAsync(0);

    // Reads start at 0, 16 s, 33 s and 52 s: each one gives up after 15 s, and the pause doubles (1 s, 2 s, 4 s).
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fake.agentReads).toHaveLength(3);
    expect(session.getSnapshot().status.phase).toBe("connecting");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.agentReads).toHaveLength(4);
    expect(session.getSnapshot().status.phase).toBe("connected");

    // Once connected, no further reads are scheduled.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.agentReads).toHaveLength(4);
  });

  it("cancels a pending retry when the connection drops", async () => {
    vi.useFakeTimers();
    fake.silentAgentReads = 1;
    session = new SaplingSession("ws://fake", undefined);
    session.start();
    fake.options?.onStatus(connected);
    await vi.advanceTimersByTimeAsync(15_000);
    fake.options?.onStatus({ phase: "connecting" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.agentReads).toHaveLength(1);
  });
});
