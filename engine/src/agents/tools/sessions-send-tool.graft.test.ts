import { expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

it("sends work to a joined Trunk contact without resolving it as a local session", async () => {
  const callGateway = vi.fn(async () => ({ id: "remote-job-1" }));
  const tool = createSessionsSendTool({
    agentSessionKey: "agent:juniper:main",
    config: { agents: { entries: { juniper: {} } }, tools: { agentToAgent: { enabled: true } } } as BranchConfig,
    callGateway,
  });
  const result = await tool.execute("tool-call-1", { sessionKey: "a2a:branch-nas-linux--tester", message: "Ping", timeoutSeconds: 0 });
  expect(result.details).toMatchObject({ runId: "remote-job-1", status: "accepted", sessionKey: "a2a:branch-nas-linux--tester", delivery: { status: "pending" } });
  expect(callGateway).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    method: "graft.work.send",
    params: { target: "a2a:branch-nas-linux--tester", text: "Ping", sourceSessionKey: "agent:juniper:main", idempotencyKey: "tool-call-1" },
  }));
});

it("tells the agent a joined Trunk is no longer linked and not to retry through the CLI", async () => {
  const callGateway = vi.fn(async () => {
    throw new Error("That teammate isn't linked anymore. Link the Branch again.");
  });
  const tool = createSessionsSendTool({
    agentSessionKey: "agent:juniper:main",
    config: { agents: { entries: { juniper: {} } }, tools: { agentToAgent: { enabled: true } } } as BranchConfig,
    callGateway,
  });
  const result = await tool.execute("tool-call-2", { sessionKey: "a2a:branch-nas-linux--gone", message: "Ping", timeoutSeconds: 0 });
  expect(result.details).toMatchObject({ status: "error", sessionKey: "a2a:branch-nas-linux--gone" });
  expect(String((result.details as { error?: string }).error)).toContain("isn't linked anymore");
  expect(String((result.details as { error?: string }).error)).toContain("Do not retry through the CLI");
});
