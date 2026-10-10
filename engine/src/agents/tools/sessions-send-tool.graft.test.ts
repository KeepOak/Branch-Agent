import { expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { buildSessionsSendOperationKey } from "./sessions-send-tool.delivery.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

it("sends work to a joined Trunk contact without resolving it as a local session", async () => {
  const callGateway = vi.fn(async () => ({ id: "remote-job-1" }));
  const tool = createSessionsSendTool({
    agentSessionKey: "agent:juniper:main",
    config: { agents: { entries: { juniper: {} } }, tools: { agentToAgent: { enabled: true } } } as BranchConfig,
    callGateway,
  });
  const args = { sessionKey: "a2a:branch-nas-linux--tester", message: "Ping", timeoutSeconds: 0 };
  const result = await tool.execute("tool-call-1", args);
  expect(result.details).toMatchObject({ runId: "remote-job-1", status: "accepted", sessionKey: "a2a:branch-nas-linux--tester", delivery: { status: "pending" } });
  expect(callGateway).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    method: "graft.work.send",
    params: { target: "a2a:branch-nas-linux--tester", text: "Ping", sourceSessionKey: "agent:juniper:main", idempotencyKey: buildSessionsSendOperationKey("agent:juniper:main", "tool-call-1", args) },
  }));
});
