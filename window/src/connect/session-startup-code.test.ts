// The session and the conversation list tell the engine's startup refusal apart by its code (UNAVAILABLE with
// details.code agent-database-inspection-pending), not its words, so the window can show one calm line for it and
// keep every other failure an error.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";
import { ConversationList } from "./conversations";
import { isStartupUnavailable } from "./preparation-status";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const RAW = "Agent main has not completed startup inspection and preparation. Inspection and writable admission continue after the Gateway listener binds.\nSessions remain unavailable until background inspection and preparation finish. If they cannot complete, stop the Gateway, run \"branch doctor --fix\", and restart.";
/** As the gateway client throws it (GatewayProtocolRequestError): the code and details ride on the error. */
const refusal = (code: string, message = RAW) => Object.assign(new Error(message), { code: "UNAVAILABLE", gatewayCode: "UNAVAILABLE", retryable: code === "agent-database-inspection-pending", details: { code, agentId: "main" } });

const fake = vi.hoisted(() => ({ options: null as Options | null, historyError: null as Error | null }));
vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) { fake.options = options; }
    start(): void {}
    stop(): void {}
    async request(method: string): Promise<unknown> {
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
      if (method === "chat.history") { if (fake.historyError) throw fake.historyError; return { messages: [] }; }
      if (method === "exec.approval.list") return [];
      return {};
    }
  },
}));

import { SaplingSession } from "./session";

const KEY = "agent:main:main";
const connected = { phase: "connected", hello: { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} } } as unknown as GatewayStatus;
let session: SaplingSession | undefined;
afterEach(() => { session?.stop(); session = undefined; fake.historyError = null; vi.useRealTimers(); });

async function connect(): Promise<SaplingSession> {
  vi.useFakeTimers();
  const next = new SaplingSession("ws://fake", undefined);
  next.start();
  fake.options?.onStatus(connected);
  await vi.advanceTimersByTimeAsync(0);
  return next;
}

describe("startup refusal by code", () => {
  it("reads the structured refusal, not the words", () => {
    expect(isStartupUnavailable(refusal("agent-database-inspection-pending"))).toBe(true);
    expect(isStartupUnavailable(Object.assign(new Error("models.list unavailable during gateway startup"), { gatewayCode: "UNAVAILABLE", details: { reason: "startup-sidecars" } }))).toBe(true);
    expect(isStartupUnavailable(refusal("agent-database-inspection-failed"))).toBe(false);
    expect(isStartupUnavailable(new Error(RAW))).toBe(false);
    expect(isStartupUnavailable(RAW)).toBe(false);
  });

  it("marks the session's error as the startup wait, then as stalled after the timeout, keeping the engine's words", async () => {
    fake.historyError = refusal("agent-database-inspection-pending");
    session = await connect();
    expect(session.getSnapshot().error).toBe(RAW);
    expect(session.getSnapshot().startup).toEqual({ detail: RAW, stalled: false });
    await vi.advanceTimersByTimeAsync(120_001);
    expect(session.getSnapshot().error).toBe("Main is still starting up. Try again in a minute.");
    expect(session.getSnapshot().startup).toEqual({ detail: RAW, stalled: true });
    fake.historyError = null;
  });

  it("keeps a real failure an error, with no startup wait", async () => {
    fake.historyError = refusal("agent-database-inspection-failed", "Agent database inspection failed.");
    session = await connect();
    expect(session.getSnapshot().error).toBe("Agent database inspection failed.");
    expect(session.getSnapshot().startup).toBeNull();
  });

  it("marks the conversation list's error the same way", async () => {
    const pending = new ConversationList(async () => { throw refusal("agent-database-inspection-pending"); }, KEY);
    await pending.start();
    expect(pending.getSnapshot()).toMatchObject({ error: RAW, startup: true });
    const broken = new ConversationList(async () => { throw new Error("permission denied"); }, KEY);
    await broken.start();
    expect(broken.getSnapshot()).toMatchObject({ error: "permission denied", startup: false });
  });
});
