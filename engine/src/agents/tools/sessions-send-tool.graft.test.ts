import { expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { graftBranchIdentity, graftTrunkIdentity } from "../../mcp/graft-join.js";
import { buildSessionsSendOperationKey } from "./sessions-send-tool.delivery.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

it("sends work to a joined Trunk contact without resolving it as a local session", async () => {
  const callGateway = vi.fn(async () => ({ id: "remote-job-1" }));
  const tool = createSessionsSendTool({
    agentSessionKey: "agent:juniper:main",
    config: {
      agents: { entries: { juniper: {} } },
      tools: { agentToAgent: { enabled: true } },
    } as BranchConfig,
    callGateway,
  });
  const args = { sessionKey: "a2a:branch-nas-linux--tester", message: "Ping", timeoutSeconds: 0 };
  const result = await tool.execute("tool-call-1", args);
  expect(result.details).toMatchObject({
    runId: "remote-job-1",
    status: "accepted",
    sessionKey: "a2a:branch-nas-linux--tester",
    delivery: { status: "pending" },
  });
  expect(callGateway).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      method: "graft.work.send",
      params: {
        target: "a2a:branch-nas-linux--tester",
        text: "Ping",
        sourceSessionKey: "agent:juniper:main",
        idempotencyKey: buildSessionsSendOperationKey("agent:juniper:main", "tool-call-1", args),
      },
    }),
  );
});

it.each(["Branch", "🌳", "Example Branch"])(
  "routes the generated teammate key for %s without local session resolution",
  async (name) => {
    const contact = graftTrunkIdentity(graftBranchIdentity(name, ""), { id: "tester" });
    const sessionKey = `a2a:${contact.id}`;
    const callGateway = vi.fn(async ({ method }: { method: string }) => {
      if (method === "graft.work.send") {
        return { id: "remote-job-2" };
      }
      throw new Error("Session key is not resolvable");
    });
    const tool = createSessionsSendTool({
      agentSessionKey: "agent:sender:main",
      config: {
        agents: { entries: { sender: {} } },
        tools: { agentToAgent: { enabled: true } },
      } as BranchConfig,
      callGateway,
    });
    const args = { sessionKey, message: "Ping", timeoutSeconds: 0 };
    const result = await tool.execute("generated-contact-send", args);
    expect(result.details).toMatchObject({
      runId: "remote-job-2",
      status: "accepted",
      sessionKey,
      delivery: { status: "pending" },
    });
    expect(callGateway).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        method: "graft.work.send",
        params: {
          target: sessionKey,
          text: "Ping",
          sourceSessionKey: "agent:sender:main",
          idempotencyKey: buildSessionsSendOperationKey(
            "agent:sender:main",
            "generated-contact-send",
            args,
          ),
        },
      }),
    );
  },
);

it.each([
  { sandboxed: true, mode: "followup", status: "forbidden", error: "Sandboxed sessions_send" },
  { sandboxed: false, mode: "steer", status: "error", error: "Joined Trunks accept new work only" },
])("keeps joined-contact restrictions for $mode with sandboxed=$sandboxed", async (testCase) => {
  const callGateway = vi.fn();
  const tool = createSessionsSendTool({
    agentSessionKey: "agent:sender:main",
    sandboxed: testCase.sandboxed,
    config: {
      agents: { entries: { sender: {} } },
      tools: { agentToAgent: { enabled: true } },
    } as BranchConfig,
    callGateway,
  });
  const result = await tool.execute("restricted-send", {
    sessionKey: "a2a:branch--tester",
    message: "Ping",
    mode: testCase.mode,
  });
  expect(result.details).toMatchObject({
    status: testCase.status,
    error: expect.stringContaining(testCase.error),
  });
  expect(callGateway).not.toHaveBeenCalled();
});

it("preserves the gateway refusal for an unlinked bare-Branch teammate", async () => {
  const callGateway = vi.fn(async () => {
    throw new Error("That Trunk is not linked to this Branch.");
  });
  const tool = createSessionsSendTool({
    agentSessionKey: "agent:sender:main",
    config: {
      agents: { entries: { sender: {} } },
      tools: { agentToAgent: { enabled: true } },
    } as BranchConfig,
    callGateway,
  });
  const result = await tool.execute("unlinked-send", {
    sessionKey: "a2a:branch--tester",
    message: "Ping",
  });
  expect(result.details).toMatchObject({
    status: "error",
    error: expect.stringContaining("not linked"),
    sessionKey: "a2a:branch--tester",
  });
  expect(callGateway).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      method: "graft.work.send",
    }),
  );
});
