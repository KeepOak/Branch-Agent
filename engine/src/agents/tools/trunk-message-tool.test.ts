import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./common.js";
import { createTrunkMessageTool, trunkMailboxKey } from "./trunk-message-tool.js";

type Sent = { sessionKey: string; mode: string; message?: string };

/** Fake gateway: sessions.list returns the given active rows; every other call succeeds. */
function harness(activeKeys: string[]) {
  const gateway = vi.fn(async (request: { method: string; params: Record<string, unknown> }) => {
    if (request.method === "sessions.list") {
      return { sessions: activeKeys.map((key) => ({ key })) };
    }
    return { ok: true };
  });
  const sent: Sent[] = [];
  const send = {
    execute: vi.fn(async (_id: string, args: Record<string, unknown>) => {
      sent.push({
        sessionKey: String(args.sessionKey),
        mode: String(args.mode),
        message: args.message as string | undefined,
      });
      return { status: "accepted" };
    }),
  } as unknown as AnyAgentTool;
  const tool = createTrunkMessageTool({
    agentId: "builder-maple",
    callGateway: gateway as never,
    createSend: () => send,
  });
  return { tool, gateway, sent };
}

describe("trunk_message", () => {
  it("steers the target's active run and never starts a second one", async () => {
    const { tool, gateway, sent } = harness(["agent:builder-elm:claude-code-1"]);
    await tool.execute(
      "call-1",
      { agentId: "builder-elm", text: "review #900 when free" },
      undefined,
    );
    expect(sent).toEqual([
      {
        sessionKey: "agent:builder-elm:claude-code-1",
        mode: "steer",
        message: "review #900 when free",
      },
    ]);
    expect(sent.some((call) => call.mode === "followup")).toBe(false);
    expect(gateway.mock.calls.map(([request]) => request.method)).not.toContain("sessions.create");
  });

  it("delivers a followup to its mailbox when the target is idle", async () => {
    const { tool, gateway, sent } = harness([]);
    await tool.execute(
      "call-2",
      { agentId: "builder-elm", text: "PR 900 needs a reviewer" },
      undefined,
    );
    const mailbox = trunkMailboxKey("builder-elm", "builder-maple");
    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.create",
        params: { key: mailbox, agentId: "builder-elm" },
      }),
    );
    expect(sent).toEqual([
      { sessionKey: mailbox, mode: "followup", message: "PR 900 needs a reviewer" },
    ]);
  });

  it("never sends a followup to a busy target, even when it is busy in another thread", async () => {
    const { tool, sent } = harness(["agent:builder-elm:owner-thread", "agent:builder-elm:other"]);
    await tool.execute("call-3", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(sent.map((call) => call.mode)).toEqual(["steer"]);
    expect(sent[0]!.sessionKey).toBe("agent:builder-elm:owner-thread");
  });

  it("keeps a sender's mailbox separate from the owner's chat and from other senders", () => {
    expect(trunkMailboxKey("builder-elm", "builder-maple")).not.toBe(
      trunkMailboxKey("builder-elm", "builder-ash"),
    );
    expect(trunkMailboxKey("builder-elm", "builder-maple")).toMatch(/^agent:builder-elm:trunk:/);
  });

  it("refuses to message itself and refuses a call with no sender identity", async () => {
    const { tool } = harness([]);
    await expect(
      tool.execute("call-4", { agentId: "builder-maple", text: "hi" }, undefined),
    ).rejects.toThrow(/another Trunk/);
    const anonymous = createTrunkMessageTool({
      callGateway: vi.fn() as never,
      createSend: () => ({ execute: vi.fn() }) as unknown as AnyAgentTool,
    });
    await expect(
      anonymous.execute("call-5", { agentId: "builder-elm", text: "hi" }, undefined),
    ).rejects.toThrow(/sender/);
  });

  it("still delivers when the mailbox already exists", async () => {
    const gateway = vi.fn(async (request: { method: string }) => {
      if (request.method === "sessions.list") {
        return { sessions: [] };
      }
      if (request.method === "sessions.create") {
        throw new Error("already exists");
      }
      return { ok: true };
    });
    const sent: Sent[] = [];
    const send = {
      execute: vi.fn(async (_id: string, args: Record<string, unknown>) => {
        sent.push({ sessionKey: String(args.sessionKey), mode: String(args.mode) });
        return { status: "accepted" };
      }),
    } as unknown as AnyAgentTool;
    const tool = createTrunkMessageTool({
      agentId: "builder-maple",
      callGateway: gateway as never,
      createSend: () => send,
    });
    await tool.execute("call-6", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(sent).toEqual([
      { sessionKey: trunkMailboxKey("builder-elm", "builder-maple"), mode: "followup" },
    ]);
  });
});
