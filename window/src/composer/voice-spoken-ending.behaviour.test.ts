// Atlas VOICE-0126 (built fresh): a spoken turn always ends with speech. When the Trunk's turn behind a call
// fails, is stopped or runs out of time, the call hands the voice a short sentence to say, never silence.
import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { spokenEnding, VoiceCall } from "./voice";

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
  return { request, emit };
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

  it("names running out of time or budget", () => {
    expect(spokenEnding(new Error("The Trunk took too long to answer."))).toBe("That took longer than I'm allowed, so I stopped. Ask me again if you still need it.");
    expect(spokenEnding(new Error("token budget exhausted"))).toMatch(/longer than I'm allowed/);
  });

  it("never hands the voice an empty line", () => {
    for (const e of [new Error(""), "", undefined, new Error("stopped"), new Error("timeout")]) expect(spokenEnding(e).trim().length).toBeGreaterThan(10);
  });
});
