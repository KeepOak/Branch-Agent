// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { JobRow, summaryLine } from "./Rows";
import { health, when } from "./model";

vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("heartbeat health", () => {
  it("counts failures and skips over the same run history so failures never exceed runs", () => {
    const runs = Array.from({ length: 50 }, (_, i) => ({ status: i === 0 ? "error" : "skipped", completionStatus: "failed" }));
    const h = health(runs, 112)!;
    expect(h.failed).toBe(1);
    expect(h.count).toBe(50);
    expect(h.failed).toBeLessThanOrEqual(h.count);
    expect(h.text).toBe("50 recent runs · 1 failed · 49 skipped");
    expect(health(runs, 12)?.count).toBe(50);
    expect(summaryLine([
      { state: { lastRunStatus: "skipped", lastStatus: "error", lastCompletionStatus: "failed" } },
      { state: { lastRunStatus: "ok", lastCompletionStatus: "failed", lastDeliveryError: "Delivery rejected" } },
    ]).failing).toBe(1);
  });

  it("renders failing-since and the last real error from the record", async () => {
    const now = Date.now(), first = now - 3600_000, last = now - 1800_000;
    const job = { id: "heartbeat", name: "Heartbeat", enabled: true, schedule: { kind: "every", everyMs: 1800_000 }, state: { lastRunStatus: "error", lastRunAtMs: last, lastError: "Provider unavailable", consecutiveErrors: 2 } };
    const host = document.createElement("div"), root = createRoot(host), open = vi.fn();
    try {
      await act(async () => root.render(<JobRow job={job} trunk="Trunk" runs={[
        { status: "error", runAtMs: last, error: "Provider unavailable" },
        { status: "error", runAtMs: first, error: "Earlier error" },
        { status: "ok", runAtMs: first - 1800_000 },
      ]} level="regular" canWrite busy={false} actions={{ open, toggle: vi.fn(), menu: vi.fn() }} />));
      expect(host.textContent).toContain(`Failing since ${when(first)}`);
      expect(host.textContent).toContain("Provider unavailable");
      expect(host.textContent).not.toContain("Earlier error");
      const why = [...host.querySelectorAll("button")].find(b => b.textContent === "See why")!;
      await act(async () => why.click());
      expect(open).toHaveBeenCalledWith(job);
    } finally { await act(async () => root.unmount()); }
  });
});
