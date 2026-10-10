import { afterEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";
const fake = vi.hoisted(() => ({ options: null as { onStatus: (status: GatewayStatus) => void } | null, read: null as Promise<unknown> | null }));
vi.mock("./gateway", () => ({ BranchGateway: class {
  constructor(options: typeof fake.options) { fake.options = options; }
  start() {}
  stop() {}
  async request(method: string) {
    if (method === "agents.list") return fake.read ?? { agents: [], defaultId: "main" };
    if (method === "chat.history") return { messages: [] };
    if (method.endsWith(".approval.list")) return [];
    return {};
  }
} }));
import { SaplingSession } from "./session";
const hello = () => ({ phase: "connected", hello: { snapshot: { sessionDefaults: { mainSessionKey: "agent:main:main" } }, auth: { scopes: [] }, policy: {} } }) as unknown as GatewayStatus;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { fake.options = null; fake.read = null; });
it("a bootstrap finishing after disconnect cannot restore a connected status", async () => {
  const session = new SaplingSession("ws://example.test", undefined); session.start();
  let resolve!: (value: unknown) => void;
  fake.read = new Promise(r => { resolve = r; });
  fake.options!.onStatus(hello());
  fake.options!.onStatus({ phase: "connecting" });
  resolve({ agents: [], defaultId: "main" }); await settle();
  expect(session.getSnapshot().status.phase).toBe("connecting");
  expect(session.engine.connected).toBe(false);
  session.stop();
});
it("an old bootstrap rejection cannot overwrite a newer hello", async () => {
  const session = new SaplingSession("ws://example.test", undefined); session.start();
  let reject!: (error: Error) => void;
  fake.read = new Promise((_, r) => { reject = r; });
  fake.options!.onStatus(hello());
  fake.options!.onStatus({ phase: "connecting" });
  fake.read = null; const next = hello(); fake.options!.onStatus(next); await settle();
  reject(new Error("gateway not connected")); await settle();
  expect(session.getSnapshot().status).toBe(next);
  expect(session.getSnapshot().error).toBeNull();
  expect(session.engine.connected).toBe(true);
  session.stop();
});
