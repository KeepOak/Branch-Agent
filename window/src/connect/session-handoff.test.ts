import { afterEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { url: string; onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options; starts: number; stops: number; requests: string[] }>, transcript: [] as Record<string, unknown>[] }));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    options: Options;
    starts = 0;
    stops = 0;
    requests: string[] = [];
    constructor(options: Options) { this.options = options; fake.gateways.push(this); }
    start(): void { this.starts++; }
    stop(): void { this.stops++; }
    reconnectNow(): void { this.starts++; }
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      this.requests.push(method);
      if (method === "chat.send") return { runId: this.options.url.endsWith(":1") ? "old-run" : "new-run" };
      if (method === "chat.history") return { messages: fake.transcript.map((entry) => ({ ...entry })) };
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
      if (method === "approval.history" || method === "exec.approval.list") return { items: [] };
      return { params };
    }
  },
}));

import { SaplingSession } from "./session";

const key = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: key } }, auth: { scopes: [] }, policy: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { fake.gateways.length = 0; fake.transcript.length = 0; });

it("routes new messages to N while O's in-flight result still reaches the open conversation", async () => {
  const session = new SaplingSession("ws://127.0.0.1:1", "shared-token");
  session.start();
  const old = fake.gateways[0]!;
  old.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  await session.send("first");
  expect(session.getSnapshot().liveRunId).toBe("old-run");

  session.handoff("ws://127.0.0.1:2");
  const next = fake.gateways[1]!;
  expect(old.stops).toBe(0);
  expect(next.starts).toBe(1);
  next.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  expect(session.getSnapshot().liveRunId).toBe("old-run");
  await session.request("status", {});
  expect(next.requests).toContain("status");
  await session.send("second");
  expect(next.requests).toContain("chat.send");
  expect(old.requests.filter((method) => method === "chat.send")).toHaveLength(1);

  fake.transcript.push({ role: "assistant", content: "old turn finished", timestamp: 1 });
  old.options.onEvent({ event: "chat", payload: { sessionKey: key, runId: "old-run", state: "final" } });
  await settle();
  expect(old.stops).toBe(1);
  expect(session.getSnapshot().history.some((block) => JSON.stringify(block).includes("old turn finished"))).toBe(true);
  session.stop();
});
