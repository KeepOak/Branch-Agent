import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraftLink } from "./graft-join.js";
import {
  FALLBACK_ADDRESSES_VERIFIED,
  GraftLinkRunner,
  GraftLinkSupervisor,
  isHostRefusal,
  type LinkClient,
  type LinkHandlers,
} from "./graft-link.js";

const link: GraftLink = { url: "ws://127.0.0.1:41010", name: "Branch B", joinedAt: 1 };

type FakeClient = LinkClient & {
  handlers: LinkHandlers;
  calls: [string, any][];
  started: number;
  stopped: number;
};
function fakeClient(reply: (method: string, params: any) => unknown = () => ({})) {
  let client!: FakeClient;
  const create = (handlers: LinkHandlers) => {
    client = {
      handlers,
      calls: [],
      started: 0,
      stopped: 0,
      start: () => void client.started++,
      stop: () => void client.stopped++,
      request: async (method, params) => {
        client.calls.push([method, params]);
        const result = reply(method, params);
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return client;
  };
  return { create, get: () => client };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const helloIds = (client: FakeClient) => client.calls.map(([, params]) => params.agent.id);

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());

describe("the joined Branch's link to its host", () => {
  it("polls work over the outbound link and returns the joined Trunk's reply", async () => {
    const job = { id: "job-1", trunkId: "tester", text: "Ping", sourceAgentId: "juniper" };
    let offered = false;
    const fake = fakeClient((method) => {
      if (method === "graft.work.poll") return { job: offered ? null : job };
      if (method === "graft.work.complete") offered = true;
      return {};
    });
    const handleWork = vi.fn(async () => ({ reply: "PONG" }));
    const runner = new GraftLinkRunner({ link, trunks: async () => [], createClient: fake.create, forget: vi.fn(), log: () => undefined, handleWork });
    runner.start();
    fake.get().handlers.onHello();
    await flush();
    await flush();
    expect(handleWork).toHaveBeenCalledWith(job);
    expect(fake.get().calls).toContainEqual(["graft.work.complete", { id: "job-1", reply: "PONG" }]);
    runner.stop();
  });
  it("says hello as the Branch and its Trunks on connect and every minute while connected", async () => {
    const fake = fakeClient();
    const runner = new GraftLinkRunner({
      link,
      trunks: async () => [{ id: "main" }, { id: "scout", name: "Scout" }],
      createClient: fake.create,
      forget: vi.fn(),
      log: () => undefined,
    });
    runner.start();
    expect(fake.get().started).toBe(1);
    fake.get().handlers.onHello();
    await flush();
    expect(runner.state).toBe("connected");
    expect(helloIds(fake.get())).toEqual(["branch-b", "branch-b--main", "branch-b--scout"]);
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(fake.get().calls).toHaveLength(6);
    runner.stop();
  });

  it("keeps the client across a dropped connection and says hello again after it reconnects", async () => {
    const fake = fakeClient();
    const forget = vi.fn();
    const runner = new GraftLinkRunner({
      link,
      trunks: async () => [],
      createClient: fake.create,
      forget,
      log: () => undefined,
    });
    runner.start();
    fake.get().handlers.onHello();
    await flush();
    fake.get().handlers.onClose();
    expect(runner.state).toBe("connecting");
    // No hellos while down (the gateway client reconnects with its own backoff; the link never stops it).
    vi.advanceTimersByTime(180_000);
    await flush();
    expect(fake.get().calls).toHaveLength(1);
    expect(fake.get().stopped).toBe(0);
    fake.get().handlers.onHello();
    await flush();
    expect(runner.state).toBe("connected");
    expect(fake.get().calls).toHaveLength(2);
    expect(forget).not.toHaveBeenCalled();
    runner.stop();
  });

  it("says why a link that never connects can't reach its host, and not on every retry", async () => {
    const fake = fakeClient();
    const lines: string[] = [];
    const runner = new GraftLinkRunner({
      link,
      trunks: async () => [],
      createClient: fake.create,
      forget: vi.fn(),
      log: (line) => lines.push(line),
    });
    runner.start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fake.get().handlers.onConnectError?.(new Error("connect ETIMEDOUT 10.0.0.5:19031"));
    }
    expect(runner.state).toBe("connecting");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("can't reach ws://127.0.0.1:41010");
    expect(lines[0]).toContain("connect ETIMEDOUT");
    expect(lines[0]).toContain("rejoin");
    runner.stop();
  });
  it("never sends the device link to a saved fallback address while fallback addresses are unverified", async () => {
    const created: string[] = [];
    const fake = fakeClient();
    const runner = new GraftLinkRunner({
      link: { url: "ws://10.0.0.5:41010", urls: ["ws://100.64.0.7:41010", "ws://10.0.0.5:41010"], name: "Branch B", joinedAt: 1 },
      trunks: async () => [],
      createClient: (handlers, url) => {
        created.push(url);
        return fake.create(handlers);
      },
      forget: vi.fn(),
      log: () => undefined,
    });
    runner.start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fake.get().handlers.onConnectError?.(new Error("connect ETIMEDOUT 10.0.0.5:41010"));
    }
    fake.get().handlers.onConnectError?.(new Error("connect ECONNREFUSED 100.64.0.7:41010"));
    expect(FALLBACK_ADDRESSES_VERIFIED).toBe(false);
    expect(created).toEqual(["ws://10.0.0.5:41010"]);
    expect(runner.state).toBe("connecting");
    runner.stop();
  });

  it("never switches addresses for a link that has only one", async () => {
    const created: string[] = [];
    const fake = fakeClient();
    const runner = new GraftLinkRunner({
      link,
      trunks: async () => [],
      createClient: (handlers, url) => {
        created.push(url);
        return fake.create(handlers);
      },
      forget: vi.fn(),
      log: () => undefined,
    });
    runner.start();
    fake.get().handlers.onConnectError?.(new Error("connect ECONNREFUSED"));
    expect(created).toEqual(["ws://127.0.0.1:41010"]);
    runner.stop();
  });

  it("stops and forgets the host when the host removed this Branch's pairing", async () => {
    const fake = fakeClient();
    const forget = vi.fn();
    const runner = new GraftLinkRunner({
      link,
      trunks: async () => [],
      createClient: fake.create,
      forget,
      log: () => undefined,
    });
    runner.start();
    fake.get().handlers.onRefused("pairing required");
    expect(runner.state).toBe("disconnected");
    expect(fake.get().stopped).toBe(1);
    expect(forget).toHaveBeenCalledWith(link);
  });

  it("stops when a hello is refused because the owner disconnected it", async () => {
    const fake = fakeClient(() =>
      Object.assign(new Error("Branch B was disconnected in Settings › Grafts.")),
    );
    const forget = vi.fn();
    const runner = new GraftLinkRunner({
      link,
      trunks: async () => [],
      createClient: fake.create,
      forget,
      log: () => undefined,
    });
    runner.start();
    fake.get().handlers.onHello();
    await flush();
    expect(runner.state).toBe("disconnected");
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it("tells a host refusal from a dropped connection", () => {
    expect(isHostRefusal({ details: { code: "PAIRING_REQUIRED" } })).toBe(true);
    expect(isHostRefusal({ details: { code: "AUTH_DEVICE_TOKEN_MISMATCH" } })).toBe(true);
    expect(isHostRefusal({ details: { code: "UNAVAILABLE" } })).toBe(false);
    expect(isHostRefusal(new Error("gateway closed (1006)"))).toBe(false);
    expect(isHostRefusal(new Error("device pairing required (requestId: r)"))).toBe(true);
  });
});

describe("the gateway's graft-link service", () => {
  it("starts a link per saved host, picks up a host saved later, and drops a disconnected one", () => {
    let saved: GraftLink[] = [link];
    const runners: { link: GraftLink; state: string; start: () => void; stop: () => void }[] = [];
    const supervisor = new GraftLinkSupervisor({
      links: () => saved,
      createRunner: (l) => {
        const runner = { link: l, state: "connecting", start: vi.fn(), stop: vi.fn() };
        runners.push(runner);
        return runner as never;
      },
    });
    supervisor.start();
    expect(runners.map((r) => r.link.url)).toEqual([link.url]);
    const later = { url: "ws://192.168.1.20:41011", name: "Branch B", joinedAt: 2 };
    saved = [link, later];
    vi.advanceTimersByTime(5_000);
    expect(runners.map((r) => r.link.url)).toEqual([link.url, later.url]);
    runners[0]!.state = "disconnected";
    saved = [later];
    vi.advanceTimersByTime(5_000);
    expect(runners[0]!.stop).toHaveBeenCalled();
    expect(Object.keys(supervisor.states())).toEqual([later.url]);
    // Re-joined with a new code: the host is saved again and a fresh link starts.
    saved = [later, link];
    supervisor.sync();
    expect(runners).toHaveLength(3);
    supervisor.stop();
    expect(runners[1]!.stop).toHaveBeenCalled();
  });
});
