import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeConfigSnapshot } from "../../config/config.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { resolveGatewaySessionStoreTargetWithStore } from "../../gateway/session-utils-store-lookup.js";
import { peekSystemEventEntries, resetSystemEventsForTest } from "../../infra/system-events.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { runSessionsSendA2AFlow } from "./sessions-send-tool.a2a.js";
import { startSessionsSendAgentRun } from "./sessions-send-tool.delivery.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

const source = "agent:main:main";
const target = "agent:main:dashboard:key-target";
const config = {
  agents: { ownership: "explicit", entries: { main: {} } },
  tools: { sessions: { visibility: "all" }, agentToAgent: { enabled: true } },
} satisfies BranchConfig;

describe("sessions_send operation identity", () => {
  let state: BranchTestState;
  beforeEach(async () => {
    state = await createBranchTestState({ scenario: "minimal" });
    setRuntimeConfigSnapshot(config);
    resetSystemEventsForTest();
    for (const key of [source, target]) {
      await replaceSessionEntry(
        { agentId: "main", sessionKey: key },
        { sessionId: key === source ? "source-session" : "target-session", updatedAt: 1 },
      );
    }
  });
  afterEach(async () => {
    resetSystemEventsForTest();
    await state.cleanup();
  });

  function tool(idempotencyKey?: string) {
    return createSessionsSendTool({
      agentSessionKey: source,
      requesterTurnRunId: "source-run",
      idempotencyKey,
      config,
      callGateway: vi.fn().mockResolvedValue({ key: target, agentId: "main" }),
    });
  }
  const args = { sessionKey: target, message: "Continue the task", mode: "notify" };

  it("two sends from one run to one target produce two deliveries", async () => {
    const send = tool("source-run");
    const first = await send.execute("send-first", args);
    const second = await send.execute("send-second", args);
    expect(first.details).toMatchObject({ status: "queued" });
    expect(second.details).toMatchObject({ status: "queued" });
    const events = peekSystemEventEntries(target);
    expect(events).toHaveLength(2);
    expect(events[0]?.contextKey).not.toBe(events[1]?.contextKey);
  });

  it("a retry of the same tool call with canonical args dedupes", async () => {
    const first = await tool().execute("send-retried", args);
    // Reconstruct the tool as a retry would, with a different JSON property order.
    await tool().execute("send-retried", {
      mode: "notify",
      message: args.message,
      sessionKey: target,
    });
    expect(first.details).toMatchObject({ status: "queued" });
    expect(peekSystemEventEntries(target)).toHaveLength(1);
  });

  it("preserves the operation key when delivery falls back to a Cron parent", async () => {
    const callGateway = vi.fn().mockResolvedValue({ runId: "target-run" });
    const sendParams = {
      message: "Continue the task",
      agentId: "main",
      sessionKey: target,
      idempotencyKey: "stable-operation",
      inputProvenance: { kind: "inter_session" as const, sourceTool: "sessions_send" },
      sourceReplyDeliveryMode: "message_tool_only" as const,
    };
    const params = {
      cfg: config,
      callGateway,
      runId: "stable-operation",
      sendParams,
      sessionKey: target,
      fallbackSessionKey: "agent:main:cron:key-target",
      sessionStoreTarget: resolveGatewaySessionStoreTargetWithStore({
        cfg: config,
        key: target,
        agentId: "main",
        readOnly: true,
      }),
    };
    await startSessionsSendAgentRun(params);
    await startSessionsSendAgentRun(params);
    expect(callGateway.mock.calls.map(([request]) => request.params)).toEqual([
      { ...sendParams, sessionKey: params.fallbackSessionKey },
      { ...sendParams, sessionKey: params.fallbackSessionKey },
    ]);
  });

  it("carries the operation key into source reply delivery despite a different target run", async () => {
    const callGateway = vi.fn().mockResolvedValue({});
    const storeTarget = resolveGatewaySessionStoreTargetWithStore({
      cfg: config,
      key: source,
      agentId: "main",
      readOnly: true,
    });
    await runSessionsSendA2AFlow({
      callGateway,
      operationKey: "stable-operation",
      runId: "different-target-run",
      targetSessionKey: source,
      targetAgentId: "main",
      displayKey: source,
      requesterSessionKey: source,
      requesterAgentId: "main",
      replyTimeoutMs: 1000,
      requesterOrigin: { channel: "telegram", to: "source-recipient" },
      requesterDeliveryGeneration: {
        agentId: "main",
        storePath: storeTarget.storePath,
        sessionKey: source,
        sessionId: "source-session",
        lifecycleRevision: null,
      },
      reply: { status: "ok", replyText: "Task complete" },
    });
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "send",
        params: expect.objectContaining({ idempotencyKey: "stable-operation" }),
      }),
    );
  });

  it("joined sends use run, call and canonical argument identity", async () => {
    const callGateway = vi.fn().mockResolvedValue({ id: "joined-delivery" });
    const send = (runId: string) =>
      createSessionsSendTool({
        config,
        agentSessionKey: source,
        requesterTurnRunId: runId,
        callGateway,
      });
    const joinedArgs = {
      sessionKey: "a2a:branch-peer--target",
      message: "Continue the task",
      mode: "followup",
    };
    await send("source-run").execute("joined-call", joinedArgs);
    await send("source-run").execute("joined-call", {
      mode: "followup",
      message: joinedArgs.message,
      sessionKey: joinedArgs.sessionKey,
    });
    await send("other-run").execute("joined-call", joinedArgs);
    await send("source-run").execute("joined-call", { ...joinedArgs, message: "Changed task" });
    const keys = callGateway.mock.calls.map(([request]) => request.params.idempotencyKey);
    expect(keys).toHaveLength(4);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("callers with no run identity scope the key by session and tool call id", async () => {
    const callGateway = vi.fn().mockResolvedValue({ id: "joined-delivery" });
    const send = (agentSessionKey: string) =>
      createSessionsSendTool({ config, agentSessionKey, callGateway });
    const joinedArgs = { sessionKey: "a2a:branch-peer--target", message: "Continue the task" };
    await send(source).execute("rpc-direct-key-1", joinedArgs);
    await send(source).execute("rpc-direct-key-1", joinedArgs);
    await send(source).execute("rpc-direct-key-2", joinedArgs);
    await send("agent:main:other").execute("rpc-direct-key-1", joinedArgs);
    const keys = callGateway.mock.calls.map(([request]) => request.params.idempotencyKey);
    expect(keys).toHaveLength(4);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });
});
