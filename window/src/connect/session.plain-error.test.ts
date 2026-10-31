// A failed conversation read keeps raw words; display formatting supplies the plain load sentence.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031|unknown method|chat\.send/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";

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
import { plainError } from "../shell/plain-error";

const KEY = "agent:main:main";
const connected = { phase: "connected", hello: { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} } } as unknown as GatewayStatus;
let session: SaplingSession | undefined;
afterEach(() => { session?.stop(); session = undefined; fake.historyError = null; localStorage.clear(); vi.useRealTimers(); });

async function connect(): Promise<SaplingSession> {
  vi.useFakeTimers();
  const next = new SaplingSession("ws://fake", undefined);
  next.start();
  fake.options?.onStatus(connected);
  await vi.advanceTimersByTimeAsync(0);
  return next;
}

describe("a failed conversation read keeps raw errors for display formatting", () => {
  it("names a refused connect in a plain load sentence", async () => {
    fake.historyError = new Error(ENGINE);
    session = await connect();
    const error = session.getSnapshot().error ?? "";
    expect(error).toBe(`Couldn't load this conversation: ${ENGINE}`);
    expect(plainError(error, true)).toBe("Couldn't load this conversation. Branch can’t reach its engine right now. It keeps trying, so try again in a moment.");
    expect(plainError(error, true)).not.toMatch(RAW);
    expect(session.getSnapshot().startup).toBeNull();
    for (const level of ["advanced", "technical"]) {
      localStorage.setItem("branch.level", level);
      expect(plainError(session.getSnapshot().error)).toBe(error);
    }
  });

  it("names an unknown method in a plain load sentence", async () => {
    fake.historyError = new Error("unknown method: chat.send");
    session = await connect();
    const error = session.getSnapshot().error ?? "";
    expect(error).toBe("Couldn't load this conversation: unknown method: chat.send");
    expect(plainError(error, true)).toBe("Couldn't load this conversation. This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(plainError(error, true)).not.toMatch(RAW);
  });
});
