import { describe, expect, it, vi } from "vitest";
import { APPROVAL_PROBE_MS, pendingApprovalsWithin } from "./update-probe";

const items = (count: number) => ({ items: Array.from({ length: count }, (_, index) => ({ id: String(index) })) });
const session = (request: (method: string) => Promise<unknown>) => ({ request: request as never });

describe("the desktop update probe answers in time (Private #1047)", () => {
  it("counts the approvals every list reports", async () => {
    const request = async (method: string) => (method === "exec.approval.list" ? items(2) : items(1));
    await expect(pendingApprovalsWithin(session(request), 9)).resolves.toBe(4);
  });

  it("answers from the approvals the window shows when the gateway never replies", async () => {
    vi.useFakeTimers();
    try {
      const answer = pendingApprovalsWithin(session(() => new Promise<never>(() => {})), 3);
      await vi.advanceTimersByTimeAsync(APPROVAL_PROBE_MS);
      await expect(answer).resolves.toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers from the approvals the window shows when a list is refused", async () => {
    const request = async (method: string) => {
      if (method === "plugin.approval.list") throw new Error("refused");
      return items(1);
    };
    await expect(pendingApprovalsWithin(session(request), 5)).resolves.toBe(5);
  });
});
