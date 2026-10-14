import { afterEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { url: string; onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options }> }));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    options: Options;
    constructor(options: Options) { this.options = options; fake.gateways.push(this); }
    start(): void {}
    stop(): void {}
    reconnectNow(): void {}
    async request(method: string): Promise<unknown> {
      if (method === "chat.history") return { messages: [] };
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
      if (method === "approval.history" || method === "exec.approval.list") return { items: [] };
      return {};
    }
  },
}));

import { SaplingSession } from "./session";

const key = "agent:main:main";
const features = { methods: ["chat.send", "sessions.list"], events: ["chat"] };
const hello = { snapshot: { sessionDefaults: { mainSessionKey: key } }, auth: { scopes: [] }, policy: {}, features };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { fake.gateways.length = 0; });

it("puts the hello's features on the engine and keeps them while the window reconnects", async () => {
  const session = new SaplingSession("ws://127.0.0.1:1", "token");
  expect(session.engine.features).toBeUndefined();
  session.start();
  const gateway = fake.gateways[0]!;
  gateway.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  expect(session.engine.features).toBe(features);
  gateway.options.onStatus({ phase: "connecting" } as unknown as GatewayStatus);
  await settle();
  expect(session.engine.connected).toBe(false);
  expect(session.engine.features).toBe(features);
  const next = { methods: ["chat.send"], events: [] };
  gateway.options.onStatus({ phase: "connected", hello: { ...hello, features: next } } as unknown as GatewayStatus);
  await settle();
  expect(session.engine.features).toBe(next);
  session.stop();
});
