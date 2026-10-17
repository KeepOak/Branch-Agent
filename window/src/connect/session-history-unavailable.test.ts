// A chat.history UNAVAILABLE for the conversation just left must not become the next Trunk's banner, and the
// same refusal on the open conversation is retried until it works, in plain words (issue #591).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

const HISTORY_STARTING_LABEL = "Still starting up…";

type Options = { onStatus: (status: GatewayStatus) => void };

const RAW = "Session access facts are unavailable; retry after session storage is ready.";
const refusal = () => Object.assign(new Error(RAW), {
  code: "UNAVAILABLE",
  gatewayCode: "UNAVAILABLE",
  retryable: true,
  retryAfterMs: 250,
  details: { method: "chat.history" },
});

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  failsLeft: 0,
  failKeys: new Set<string>(),
  holds: new Map<string, Promise<void>>(),
  releasers: new Map<string, () => void>(),
  historyCalls: [] as string[],
  arm(key: string) {
    this.releasers.get(key)?.();
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        if (this.holds.get(key) !== promise) return;
        this.holds.delete(key);
        this.releasers.delete(key);
        resolve();
      };
    });
    this.holds.set(key, promise);
    this.releasers.set(key, release);
  },
  release(key: string) {
    this.releasers.get(key)?.();
  },
  releaseAll() {
    for (const release of [...this.releasers.values()]) release();
  },
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      if (method === "chat.history") {
        const key = String(params?.sessionKey ?? "");
        fake.historyCalls.push(key);
        const held = fake.holds.get(key);
        if (held) await held;
        if (fake.failKeys.has(key) || fake.failsLeft > 0) {
          if (fake.failsLeft > 0) fake.failsLeft -= 1;
          throw refusal();
        }
        return { sessionId: `${key}-id`, messages: [] };
      }
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }, { id: "oak", name: "Oak" }], defaultId: "main" };
      if (method === "exec.approval.list" || method === "approval.history") return { items: [] };
      return {};
    }
  },
}));

import { SaplingSession } from "./session";

const MAIN = "agent:main:main";
const OAK = "agent:oak:main";
const hello = (mainSessionKey: string): GatewayStatus =>
  ({ phase: "connected", hello: { snapshot: { sessionDefaults: { mainSessionKey } }, auth: { scopes: [] }, policy: {} } }) as unknown as GatewayStatus;

let session: SaplingSession | undefined;
afterEach(() => {
  session?.stop();
  session = undefined;
  fake.releaseAll();
  fake.options = null;
  fake.failsLeft = 0;
  fake.failKeys.clear();
  fake.historyCalls = [];
  fake.holds.clear();
  fake.releasers.clear();
  vi.useRealTimers();
});

function start(mainSessionKey = MAIN): SaplingSession {
  const next = new SaplingSession("ws://fake", undefined);
  next.start();
  fake.options?.onStatus(hello(mainSessionKey));
  return next;
}

describe("chat.history UNAVAILABLE", () => {
  it("does not carry a late refusal for the previous conversation onto the open one, and clears when the default Trunk changes", async () => {
    vi.useFakeTimers();
    fake.failKeys.add(MAIN);
    fake.arm(MAIN);
    session = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.historyCalls).toContain(MAIN);
    await session.open(OAK);
    expect(session.getSnapshot()).toMatchObject({ sessionKey: OAK, error: null, historyReady: true });
    fake.release(MAIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().sessionKey).toBe(OAK);
    expect(session.getSnapshot().error).toBeNull();
    expect(String(session.getSnapshot().error ?? "")).not.toContain("Session access facts");

    session.stop();
    fake.releaseAll();
    fake.failKeys.clear();
    fake.failsLeft = 1_000_000;
    session = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().error).toBeTruthy();
    fake.failsLeft = 0;
    fake.arm(OAK);
    fake.options?.onStatus(hello(OAK));
    expect(session.getSnapshot()).toMatchObject({ sessionKey: OAK, mainKey: OAK, error: null });
    expect(String(session.getSnapshot().error ?? "")).not.toContain("Session access facts");
    fake.release(OAK);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().error).toBeNull();
  });

  it("retries an UNAVAILABLE read with a backoff, in plain words, and clears the banner once it works", async () => {
    vi.useFakeTimers();
    fake.failsLeft = 2;
    session = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().error).toBe(HISTORY_STARTING_LABEL);
    expect(session.getSnapshot().error).not.toContain("Session access facts");
    expect(session.getSnapshot().error).not.toContain("session storage");
    const before = fake.historyCalls.filter((key) => key === MAIN).length;
    await vi.advanceTimersByTimeAsync(500);
    expect(fake.historyCalls.filter((key) => key === MAIN).length).toBeGreaterThan(before);
    expect(session.getSnapshot().error).toBe(HISTORY_STARTING_LABEL);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot().error).toBeNull();
    expect(session.getSnapshot().historyReady).toBe(true);
  });
});
