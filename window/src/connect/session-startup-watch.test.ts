// The window reconnects and recovers from the session, not from the page on screen. A Trunk still getting
// ready stops the conversation read after two minutes; when the engine lets the Trunk through, the session
// reads the conversation again by itself, so Settings or any other page sees the recovery with no navigation.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  held: true,
  historyReads: 0,
  historyFailures: 0,
  agentsLists: 0,
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
        case "agents.list":
          fake.agentsLists += 1;
          return { agents: [{ id: "main", name: "Main", ...(fake.held ? { admissionRefusal: { code: "agent-database-inspection-pending", preparation: { state: "preparing" } } } : {}) }], defaultId: "main" };
        case "chat.history":
          fake.historyReads += 1;
          if (fake.historyFailures > 0) {
            fake.historyFailures -= 1;
            throw new Error("Agent main has not completed startup inspection and preparation; run branch doctor --fix");
          }
          return { messages: [] };
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
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
const connected = { phase: "connected", hello } as unknown as GatewayStatus;
const CAP_LABEL = "Main is still starting up. Try again in a minute.";

let session: SaplingSession | undefined;
afterEach(() => {
  session?.stop();
  session = undefined;
  vi.useRealTimers();
  fake.held = true;
  fake.historyFailures = 0;
  fake.historyReads = 0;
  fake.agentsLists = 0;
});

/** Connects while the engine holds the Trunk back, then waits out the two-minute read window. */
async function stalledSession(): Promise<SaplingSession> {
  vi.useFakeTimers();
  fake.historyFailures = 1_000_000;
  const next = new SaplingSession("ws://fake", undefined);
  next.start();
  fake.options?.onStatus(connected);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(120_001);
  expect(next.getSnapshot().error).toBe(CAP_LABEL);
  return next;
}

describe("session startup watch", () => {
  it("reads the conversation again by itself once the Trunk is ready, with no page opening it", async () => {
    session = await stalledSession();
    const readsBefore = fake.historyReads;
    fake.held = false;
    fake.historyFailures = 0;

    await vi.advanceTimersByTimeAsync(3_500);

    expect(fake.historyReads).toBeGreaterThan(readsBefore);
    expect(session.getSnapshot().error).toBeNull();
    expect(session.getSnapshot().historyReady).toBe(true);
  });

  it("keeps the window quiet while the Trunk is still held back, reading only what the engine says", async () => {
    session = await stalledSession();
    const readsBefore = fake.historyReads;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fake.historyReads).toBe(readsBefore);
    expect(fake.agentsLists).toBeGreaterThan(0);
    expect(session.getSnapshot().error).toBe(CAP_LABEL);
  });

  it("hands the pages a new engine handle after a recovery, so Settings re-reads from it", async () => {
    session = await stalledSession();
    const engineBefore = session.engine;
    fake.held = false;
    fake.historyFailures = 0;

    await vi.advanceTimersByTimeAsync(3_500);

    expect(session.getSnapshot().error).toBeNull();
    expect(session.engine).not.toBe(engineBefore);
  });
});
