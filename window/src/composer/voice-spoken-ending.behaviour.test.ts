// Atlas VOICE-0126 (built fresh): a spoken turn always ends with speech. When the Trunk's turn behind a call
// fails, is stopped or runs out of time, the call hands the voice a short sentence to say, never silence.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { spokenEnding, VoiceCall, VoiceWaitTimeout } from "./voice";

type Listener = (e: { event: string; payload?: unknown }) => void;

function callWith(toolCall: () => Promise<unknown>) {
  let listener: Listener | null = null;
  const request = vi.fn(async (method: string) => (method === "talk.client.toolCall" ? toolCall() : {}));
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: (fn) => ((listener = fn), () => undefined), sessionKey: "agent:main:x", scopes: [] };
  const call = new VoiceCall(engine, { onState: () => undefined, onCaption: () => undefined, onLevel: () => undefined });
  (call as unknown as { relay: string }).relay = "r1";
  (call as unknown as { event: (p: Record<string, unknown>) => void }).event({ relaySessionId: "r1", type: "toolCall", callId: "c1", name: "branch_agent_consult", args: "{}" });
  /** Sends the run's chat event once the call is waiting for it. */
  const emit = async (payload: unknown) => {
    await vi.waitFor(() => expect(listener).not.toBeNull());
    listener?.({ event: "chat", payload });
  };
  /** True once the call is subscribed to the run's chat events, which is when its wait timer starts. */
  const listening = () => listener !== null;
  return { request, emit, listening };
}

const spoken = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([m]) => m === "talk.session.submitToolResult").map(([, p]) => (p as { result: { result?: unknown; error?: unknown } }).result);

describe("a spoken turn always ends with speech", () => {
  it("says a short sentence when the Trunk's turn is stopped", async () => {
    const { request, emit } = callWith(async () => ({ runId: "run1" }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("talk.client.toolCall", expect.anything()));
    await emit({ runId: "run1", state: "aborted" });
    await vi.waitFor(() => expect(spoken(request)).toEqual([{ result: "I stopped that one. Tell me if you want me to try again." }]));
  });

  it("says a short sentence when the Trunk's turn fails", async () => {
    const { request, emit } = callWith(async () => ({ runId: "run2" }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("talk.client.toolCall", expect.anything()));
    await emit({ runId: "run2", state: "error", errorMessage: "provider exploded" });
    await vi.waitFor(() => expect(spoken(request)).toEqual([{ result: "Something went wrong and I couldn't finish that. You can ask me again." }]));
  });

  it("says a short sentence when the turn cannot even start", async () => {
    const { request } = callWith(async () => { throw new Error("gateway closed"); });
    await vi.waitFor(() => expect(spoken(request)).toHaveLength(1));
    expect(spoken(request)[0]).toEqual({ result: "Something went wrong and I couldn't finish that. You can ask me again." });
  });

  describe("when the call stops waiting before the run answers", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("says the work may still be running, not that it stopped, after the real 120-second wait", async () => {
      vi.useFakeTimers();
      const { request, emit, listening } = callWith(async () => ({ runId: "run3" }));
      for (let i = 0; i < 20 && !listening(); i++) await Promise.resolve();
      expect(listening()).toBe(true);
      expect(request).toHaveBeenCalledWith("talk.client.toolCall", expect.anything());
      await vi.advanceTimersByTimeAsync(119_999);
      expect(spoken(request)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 20 && spoken(request).length === 0; i++) await Promise.resolve();
      expect(spoken(request)).toEqual([{ result: "That's taking longer than I can wait on this call. It may still be running, so check the chat before you ask again." }]);
      expect(String(spoken(request)[0]?.result)).not.toMatch(/stopped|try again|ask me again/i);
      // The run is still pending: nothing claimed to cancel it, and a late answer is not spoken twice.
      expect(request.mock.calls.map(([m]) => m)).toEqual(["talk.client.toolCall", "talk.session.submitToolResult"]);
      await emit({ runId: "run3", state: "final", message: { content: "done late" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(spoken(request)).toHaveLength(1);
    });
  });

  it("names a run the Trunk itself ended for time or budget", () => {
    expect(spokenEnding(new VoiceWaitTimeout("The Trunk took too long to answer."))).toMatch(/may still be running/);
    expect(spokenEnding(new Error("The Trunk took too long to answer."))).not.toMatch(/longer than I'm allowed/);
    expect(spokenEnding(new Error("token budget exhausted"))).toMatch(/longer than I'm allowed/);
    expect(spokenEnding(new Error("run timed out"))).toMatch(/longer than I'm allowed/);
  });

  it("never hands the voice an empty line", () => {
    for (const e of [new Error(""), "", undefined, new Error("stopped"), new Error("timeout")]) expect(spokenEnding(e).trim().length).toBeGreaterThan(10);
  });
});
