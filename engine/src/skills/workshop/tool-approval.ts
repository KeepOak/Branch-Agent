import { randomUUID } from "node:crypto";

type ToolApprovalIdentity = { proposalId: string; revisionHash: string; agentId: string };
export type WorkshopToolApproval = Readonly<ToolApprovalIdentity>;
const receipts = new WeakSet<WorkshopToolApproval>();
const pending = new Map<
  string,
  { identity: ToolApprovalIdentity; expiresAt: number; allowed: boolean }
>();
export const WORKSHOP_TOOL_APPROVAL_PARAM = "__workshop_tool_approval";

/** Private, single-use authority issued only by the trusted approval hook. */
export function prepareWorkshopToolApproval(identity: ToolApprovalIdentity) {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) {
      pending.delete(token);
    }
  }
  const token = randomUUID();
  pending.set(token, { identity: { ...identity }, expiresAt: now + 90_000, allowed: false });
  return {
    token,
    resolve: (decision: string) => {
      const entry = pending.get(token);
      if (decision === "allow-once" && entry) {
        entry.allowed = true;
      } else {
        pending.delete(token);
      }
    },
  };
}

export function consumeWorkshopToolApproval(token: unknown): WorkshopToolApproval | undefined {
  if (typeof token !== "string") {
    return undefined;
  }
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry?.allowed || entry.expiresAt <= Date.now()) {
    return undefined;
  }
  const receipt = Object.freeze({ ...entry.identity });
  receipts.add(receipt);
  return receipt;
}

export function assertWorkshopToolApproval(
  receipt: WorkshopToolApproval | undefined,
  identity: ToolApprovalIdentity,
): void {
  if (
    !receipt ||
    !receipts.has(receipt) ||
    receipt.agentId !== identity.agentId ||
    receipt.proposalId !== identity.proposalId ||
    receipt.revisionHash !== identity.revisionHash
  ) {
    throw new Error(
      "Publishing a Workshop tool requires approval of this exact proposal revision.",
    );
  }
}
