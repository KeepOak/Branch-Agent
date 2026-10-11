// The model-change approve card rides the Branch Agent change approval manager.
import { describe, expect, it, vi } from "vitest";
import type { SystemAgentApprovalRequestPayload } from "../../infra/system-agent-approvals.js";
import { createPreparedTestApprovalManager } from "../exec-approval-manager.test-support.js";
import { requestModelChoiceApproval } from "./model-choice-approval.js";
import type { GatewayRequestContext } from "./types.js";

function contextDeciding(
  manager: GatewayRequestContext["systemAgentApprovalManager"],
  decision: "allow-once" | "deny",
) {
  const requested: Array<{ id: string; request: SystemAgentApprovalRequestPayload }> = [];
  const broadcast = vi.fn((event: string, payload: unknown) => {
    if (event !== "branch.approval.requested") {
      return;
    }
    const record = payload as { id: string; request: SystemAgentApprovalRequestPayload };
    requested.push(record);
    setTimeout(() => void manager?.resolve(record.id, decision, "operator"), 0);
  });
  const context = {
    systemAgentApprovalManager: manager,
    broadcast,
    broadcastToConnIds: vi.fn(),
    hasExecApprovalClients: () => true,
  } as unknown as GatewayRequestContext;
  return { context, requested };
}

describe("model change approval", () => {
  it("shows one approve card and returns allow only after the person allows", async (test) => {
    const { manager } = await createPreparedTestApprovalManager<SystemAgentApprovalRequestPayload>(
      test,
      {
        approvalKind: "system-agent",
        resolveAllowedDecisions: (request) => request.allowedDecisions,
      },
    );
    const { context, requested } = contextDeciding(manager, "allow-once");
    await expect(
      requestModelChoiceApproval({ context, question: "Switch to openai/gpt-5.5?" }),
    ).resolves.toBe("allow");
    expect(requested).toHaveLength(1);
    expect(requested[0]?.request).toMatchObject({
      title: "Switch model",
      description: "Switch to openai/gpt-5.5?",
      allowedDecisions: ["allow-once", "deny"],
    });
  });

  it("returns deny when the person declines", async (test) => {
    const { manager } = await createPreparedTestApprovalManager<SystemAgentApprovalRequestPayload>(
      test,
      {
        approvalKind: "system-agent",
        resolveAllowedDecisions: (request) => request.allowedDecisions,
      },
    );
    const { context, requested } = contextDeciding(manager, "deny");
    await expect(
      requestModelChoiceApproval({ context, question: "Switch to openai/gpt-5.5?" }),
    ).resolves.toBe("deny");
    expect(requested).toHaveLength(1);
  });

  it("reports unavailable without an approval manager", async () => {
    const context = { broadcast: vi.fn() } as unknown as GatewayRequestContext;
    await expect(requestModelChoiceApproval({ context, question: "Switch?" })).resolves.toBe(
      "unavailable",
    );
    expect(context.broadcast).not.toHaveBeenCalled();
  });
});
