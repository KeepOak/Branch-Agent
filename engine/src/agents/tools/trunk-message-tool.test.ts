import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./common.js";
import { createTrunkMessageTool, trunkMailboxKey } from "./trunk-message-tool.js";

type Row = {
  key: string;
  createdActor?: { type: string };
  spawnedBy?: string;
};
type SendCall = { sessionKey: string; mode: string; message?: string };
type Steer = "ok" | "refused-result" | "refused-throw";

const NO_STEERABLE =
  "Target has no active run that accepts steering. Use mode=followup to start a new turn.";

/** A Trunk-owned task thread, as created by an agent. */
const taskThread = (key: string): Row => ({ key, createdActor: { type: "agent" } });
/** The owner's live chat, created by a human. */
const ownerChat = (key: string): Row => ({ key, createdActor: { type: "human" } });

/**
 * Fake gateway and sessions_send. `listings` answers each sessions.list call in order (the last one repeats).
 * Each send records what it was asked to do; steer behaves as configured.
 */
function harness(options: { listings: Row[][]; steer?: Steer; denial?: string }) {
  let listIndex = 0;
  const listCalls: Record<string, unknown>[] = [];
  const gatewayCalls: string[] = [];
  const gateway = vi.fn(async (request: { method: string; params: Record<string, unknown> }) => {
    gatewayCalls.push(request.method);
    if (request.method === "sessions.list") {
      listCalls.push(request.params);
      const rows = options.listings[Math.min(listIndex, options.listings.length - 1)] ?? [];
      listIndex += 1;
      return { sessions: rows };
    }
    return { ok: true };
  });
  const sent: SendCall[] = [];
  const send = {
    execute: vi.fn(async (_id: string, args: Record<string, unknown>) => {
      const call = {
        sessionKey: String(args.sessionKey),
        mode: String(args.mode),
        message: args.message as string | undefined,
      };
      sent.push(call);
      if (call.mode === "steer" && options.steer !== "ok") {
        if (options.steer === "refused-throw") {
          throw new Error(NO_STEERABLE);
        }
        return { details: { status: "error", error: NO_STEERABLE } };
      }
      return { details: { status: "accepted" } };
    }),
  } as unknown as AnyAgentTool;
  const tool = createTrunkMessageTool({
    agentId: "builder-maple",
    callGateway: gateway as never,
    createSend: () => send,
    agentToAgentDenial: () => options.denial,
  });
  return { tool, gatewayCalls, listCalls, sent };
}

const modes = (sent: SendCall[]) => sent.map((call) => call.mode);

describe("trunk_message", () => {
  it("asks sessions.list for the target's own active sessions only", async () => {
    const { tool, listCalls } = harness({ listings: [[]] });
    await tool.execute("c0", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(listCalls).toEqual([
      {
        agentId: "builder-elm",
        activeOnly: true,
        excludeSubagents: true,
        excludeCron: true,
        excludeSystem: true,
        limit: 20,
      },
    ]);
  });

  it("steers an active Trunk task thread and never starts a second run", async () => {
    const { tool, gatewayCalls, sent } = harness({
      listings: [[taskThread("agent:builder-elm:claude-code-1")]],
      steer: "ok",
    });
    await tool.execute("c1", { agentId: "builder-elm", text: "review #900 when free" }, undefined);
    expect(sent).toEqual([
      {
        sessionKey: "agent:builder-elm:claude-code-1",
        mode: "steer",
        message: "review #900 when free",
      },
    ]);
    expect(gatewayCalls).not.toContain("sessions.create");
  });

  it("never steers into the owner's live chat: a busy owner chat gets a queued mailbox notice", async () => {
    const { tool, sent } = harness({
      listings: [
        [ownerChat("agent:builder-elm:main"), ownerChat("agent:builder-elm:desktop-chat")],
      ],
    });
    await tool.execute(
      "c2",
      { agentId: "builder-elm", text: "PR 900 needs a reviewer" },
      undefined,
    );
    expect(sent).toEqual([
      {
        sessionKey: trunkMailboxKey("builder-elm", "builder-maple"),
        mode: "notify",
        message: "PR 900 needs a reviewer",
      },
    ]);
  });

  it("never steers into the main session even when it was created by an agent", async () => {
    const { tool, sent } = harness({
      listings: [[{ key: "agent:builder-elm:main", createdActor: { type: "agent" } }]],
    });
    await tool.execute("c3", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(modes(sent)).toEqual(["notify"]);
  });

  it("never steers into a subagent or child run, even if one is listed", async () => {
    const { tool, sent } = harness({
      listings: [
        [
          {
            key: "agent:builder-elm:subagent:worker-1",
            createdActor: { type: "agent" },
            spawnedBy: "agent:builder-elm:main",
          },
        ],
      ],
    });
    await tool.execute("c4", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(modes(sent)).toEqual(["notify"]);
    expect(sent[0]!.sessionKey).toBe(trunkMailboxKey("builder-elm", "builder-maple"));
  });

  it("delivers a followup to the mailbox when the target is idle", async () => {
    const { tool, gatewayCalls, sent } = harness({ listings: [[]] });
    await tool.execute(
      "c5",
      { agentId: "builder-elm", text: "PR 900 needs a reviewer" },
      undefined,
    );
    expect(gatewayCalls).toContain("sessions.create");
    expect(sent).toEqual([
      {
        sessionKey: trunkMailboxKey("builder-elm", "builder-maple"),
        mode: "followup",
        message: "PR 900 needs a reviewer",
      },
    ]);
  });

  it("falls through to a followup when the target goes idle between the list and the steer", async () => {
    const { tool, sent } = harness({
      listings: [[taskThread("agent:builder-elm:task-1")], []],
      steer: "refused-result",
    });
    await tool.execute("c6", { agentId: "builder-elm", text: "ready for review" }, undefined);
    expect(sent.map((call) => [call.mode, call.sessionKey])).toEqual([
      ["steer", "agent:builder-elm:task-1"],
      ["followup", trunkMailboxKey("builder-elm", "builder-maple")],
    ]);
  });

  it("falls through when the steer throws the no-active-run error and the target went idle", async () => {
    const { tool, sent } = harness({
      listings: [[taskThread("agent:builder-elm:task-1")], []],
      steer: "refused-throw",
    });
    await tool.execute("c7", { agentId: "builder-elm", text: "ready" }, undefined);
    expect(modes(sent)).toEqual(["steer", "followup"]);
  });

  it("queues a mailbox notice, never a parallel run, when the steer is refused and the target is still busy", async () => {
    const { tool, sent } = harness({
      listings: [[taskThread("agent:builder-elm:task-1")], [ownerChat("agent:builder-elm:main")]],
      steer: "refused-result",
    });
    await tool.execute("c8", { agentId: "builder-elm", text: "ready" }, undefined);
    expect(modes(sent)).toEqual(["steer", "notify"]);
    expect(sent.some((call) => call.mode === "followup")).toBe(false);
  });

  it("checks the agent-to-agent policy before creating the mailbox", async () => {
    const { tool, gatewayCalls, sent } = harness({
      listings: [[]],
      denial: "Agent-to-agent messaging denied by tools.agentToAgent.allow.",
    });
    const result = await tool.execute("c9", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(gatewayCalls).not.toContain("sessions.create");
    expect(gatewayCalls).not.toContain("sessions.list");
    expect(sent).toEqual([]);
    expect(result.details).toMatchObject({ status: "forbidden" });
  });

  it("never steers into another sender's active mailbox on the same target", async () => {
    // Trunk A (builder-ash) has an active mailbox on T (builder-elm). Trunk B (builder-maple) messages T.
    const aMailbox = trunkMailboxKey("builder-elm", "builder-ash");
    const { tool, sent } = harness({
      listings: [[{ key: aMailbox, createdActor: { type: "agent" } }]],
    });
    await tool.execute("c13", { agentId: "builder-elm", text: "from B" }, undefined);
    expect(sent.some((call) => call.sessionKey === aMailbox)).toBe(false);
    expect(sent).toEqual([
      {
        sessionKey: trunkMailboxKey("builder-elm", "builder-maple"),
        mode: "notify",
        message: "from B",
      },
    ]);
  });

  it("steers into the sender's own active mailbox on the target", async () => {
    const own = trunkMailboxKey("builder-elm", "builder-maple");
    const { tool, sent } = harness({
      listings: [[{ key: own, createdActor: { type: "agent" } }]],
      steer: "ok",
    });
    await tool.execute("c14", { agentId: "builder-elm", text: "follow up" }, undefined);
    expect(sent).toEqual([{ sessionKey: own, mode: "steer", message: "follow up" }]);
  });

  it("keeps a sender's mailbox separate from the owner's chat and from other senders", () => {
    expect(trunkMailboxKey("builder-elm", "builder-maple")).not.toBe(
      trunkMailboxKey("builder-elm", "builder-ash"),
    );
    expect(trunkMailboxKey("builder-elm", "builder-maple")).toMatch(/^agent:builder-elm:trunk:/);
  });

  it("refuses to message itself and refuses a call with no sender identity", async () => {
    const { tool } = harness({ listings: [[]] });
    await expect(
      tool.execute("c10", { agentId: "builder-maple", text: "hi" }, undefined),
    ).rejects.toThrow(/another Trunk/);
    const anonymous = createTrunkMessageTool({
      callGateway: vi.fn() as never,
      createSend: () => ({ execute: vi.fn() }) as unknown as AnyAgentTool,
      agentToAgentDenial: () => undefined,
    });
    await expect(
      anonymous.execute("c11", { agentId: "builder-elm", text: "hi" }, undefined),
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
    const sent: SendCall[] = [];
    const send = {
      execute: vi.fn(async (_id: string, args: Record<string, unknown>) => {
        sent.push({ sessionKey: String(args.sessionKey), mode: String(args.mode) });
        return { details: { status: "accepted" } };
      }),
    } as unknown as AnyAgentTool;
    const tool = createTrunkMessageTool({
      agentId: "builder-maple",
      callGateway: gateway as never,
      createSend: () => send,
      agentToAgentDenial: () => undefined,
    });
    await tool.execute("c12", { agentId: "builder-elm", text: "hi" }, undefined);
    expect(sent).toEqual([
      { sessionKey: trunkMailboxKey("builder-elm", "builder-maple"), mode: "followup" },
    ]);
  });
});
