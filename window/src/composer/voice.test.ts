import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { pcm16, toBase64, ulaw, VoiceCall } from "./voice";

describe("voice audio", () => {
  it("encodes µ-law and PCM16 the way the engine's Talk relay reads them", () => {
    expect([...ulaw(new Float32Array([0, 1, -1]))]).toEqual([0xff, 0x80, 0x00]);
    expect([...pcm16(new Float32Array([0, 1, -1]))]).toEqual([0, 0, 0xff, 0x7f, 0, 0x80]);
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });
});

describe("talking live", () => {
  it("runs a consult with talk.client.toolCall and hands the Trunk's answer back", async () => {
    let listener: (e: { event: string; payload?: unknown }) => void = () => undefined;
    const request = vi.fn(async (method: string) => (method === "talk.client.toolCall" ? { runId: "run1" } : {}));
    const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: (fn) => ((listener = fn), () => undefined), sessionKey: "agent:main:x", scopes: [] };
    const states: string[] = [];
    const call = new VoiceCall(engine, { onState: (s) => states.push(s), onCaption: () => undefined, onLevel: () => undefined });
    (call as unknown as { relay: string }).relay = "r1";
    (call as unknown as { event: (p: Record<string, unknown>) => void }).event({ relaySessionId: "r1", type: "toolCall", callId: "c1", name: "branch_agent_consult", args: '{"question":"what next"}' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("talk.client.toolCall", { sessionKey: "agent:main:x", callId: "c1", name: "branch_agent_consult", args: { question: "what next" }, relaySessionId: "r1" }));
    listener({ event: "chat", payload: { runId: "run1", state: "final", message: { content: [{ type: "text", text: "Write the summary next." }] } } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("talk.session.submitToolResult", { sessionId: "r1", callId: "c1", result: { result: "Write the summary next." } }));
    expect(states).toContain("thinking");
  });

  it("says no to a tool the window doesn't run", async () => {
    const request = vi.fn(async () => ({}));
    const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "k", scopes: [] };
    const call = new VoiceCall(engine, { onState: () => undefined, onCaption: () => undefined, onLevel: () => undefined });
    (call as unknown as { relay: string }).relay = "r1";
    (call as unknown as { event: (p: Record<string, unknown>) => void }).event({ relaySessionId: "r1", type: "toolCall", callId: "c2", name: "other_tool" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("talk.session.submitToolResult", { sessionId: "r1", callId: "c2", result: { error: 'Tool "other_tool" not available in this window' } }));
  });
});
