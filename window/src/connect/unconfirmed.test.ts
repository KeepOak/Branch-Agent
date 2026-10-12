// @vitest-environment jsdom
// "Not confirmed yet" messages are checked on their own engine only, with a backoff while a read keeps failing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLine, saveLine, type QueueItem } from "../composer/queue";
import { engineKeyOf, FirstSendEcho, sameEngine, UnconfirmedSends } from "./unconfirmed";

const KEY = "agent:main:main";
const record = (engine: string): QueueItem => ({ id: "lost", text: "Hello", files: [], state: "checking", sentTo: { engine, at: 1, existed: true, owner: "w" } });

function checker(request: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  return new UnconfirmedSends({ request, engine: () => "here|", view: { before: () => () => undefined, after: () => undefined }, notice: () => undefined });
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("checking messages sent but not confirmed", () => {
  it("backs off while the read keeps failing: 5 s, 15 s, 60 s, then every 5 minutes", async () => {
    vi.useFakeTimers();
    saveLine(localStorage, KEY, [record("here|")]);
    const reads: number[] = [];
    const unconfirmed = checker(async () => {
      reads.push(Date.now());
      throw new Error("gateway closed (1006)");
    });
    const start = Date.now();
    await unconfirmed.check();
    for (const step of [5_000, 15_000, 60_000, 300_000, 300_000]) await vi.advanceTimersByTimeAsync(step);
    expect(reads.map((t) => t - start)).toEqual([0, 5_000, 20_000, 80_000, 380_000, 680_000]);
    expect(loadLine(localStorage, KEY)).toMatchObject([{ state: "checking" }]);
    unconfirmed.stop();
  });

  it("never reads or sends a record that went to another engine", async () => {
    saveLine(localStorage, KEY, [record("there|")]);
    const calls: string[] = [];
    const unconfirmed = checker(async (method) => {
      calls.push(method);
      return {};
    });
    await unconfirmed.check();
    expect(calls).toEqual([]);
    unconfirmed.stop();
  });

  it("tells engines apart by host and state folder, and keeps one engine across a handoff to a new port", () => {
    const hello = (stateDir: string) => ({ snapshot: { stateDir } });
    expect(sameEngine(engineKeyOf("ws://127.0.0.1:19700", hello("/a")), engineKeyOf("ws://127.0.0.1:19711", hello("/a")))).toBe(true);
    expect(engineKeyOf("ws://127.0.0.1:19700", hello("/a"))).not.toBe(engineKeyOf("ws://127.0.0.1:19800", hello("/b")));
    expect(engineKeyOf("wss://vm-1.example:443", null)).not.toBe(engineKeyOf("wss://vm-2.example:443", null));
    // The engine names its state folder only to admin callers: a hello without one doesn't make it another engine.
    expect(sameEngine(engineKeyOf("ws://127.0.0.1:19700", hello("/a")), engineKeyOf("ws://127.0.0.1:19711", null))).toBe(true);
    expect(sameEngine(engineKeyOf("ws://127.0.0.1:19700", hello("/a")), engineKeyOf("ws://127.0.0.1:19800", hello("/b")))).toBe(false);
    expect(sameEngine(undefined, engineKeyOf("ws://127.0.0.1:19700", null))).toBe(false);
    expect(sameEngine(engineKeyOf("wss://vm.example:443", null), engineKeyOf("wss://vm.example:444", null))).toBe(false);
    expect(sameEngine(engineKeyOf("wss://vm.example:443", hello("/a")), engineKeyOf("wss://vm.example:444", hello("/a")))).toBe(true);
  });

  it("holds one first-send echo for its conversation until it is cleared", () => {
    const echo = new FirstSendEcho();
    echo.set(KEY, "What is 2+3?", "run-1");
    expect(echo.peek(KEY)).toEqual({ text: "What is 2+3?", runId: "run-1" });
    expect(echo.peek("agent:other:main")).toBeNull();
    echo.clear("other-run");
    expect(echo.peek(KEY)?.text).toBe("What is 2+3?");
    echo.clear("run-1");
    expect(echo.peek(KEY)).toBeNull();
  });

  it("keeps asking for receipts after a refusal without them proves the read itself was denied", async () => {
    const denied = Object.assign(new Error("not allowed"), { gatewayCode: "INVALID_REQUEST" });
    const reads: Record<string, unknown>[] = [];
    let deny = true;
    const unconfirmed = checker(async (_method, params) => {
      reads.push(params);
      if (deny) throw denied;
      return { sessionId: "s1", hasMore: false, messages: [], inputReceipts: [{ runId: "second" }] };
    });
    saveLine(localStorage, KEY, [record("here|")]);
    await unconfirmed.check();
    expect(reads.map((read) => Boolean(read.inputRunIds))).toEqual([true, false]);
    deny = false;
    saveLine(localStorage, KEY, [{ ...record("here|"), id: "second" }]);
    await unconfirmed.check();
    expect(reads.at(-1)?.inputRunIds).toEqual(["second"]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
    unconfirmed.stop();
  });
});
