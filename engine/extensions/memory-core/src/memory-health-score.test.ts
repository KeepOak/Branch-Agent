import { describe, expect, it } from "vitest";
import { computeMemoryHealthScore } from "./memory-health-score.js";

describe("memory health score from engine evidence", () => {
  it("does not report an unperformed embedding probe as verified", () => {
    expect(computeMemoryHealthScore({ status: {} })).toEqual({
      score: 100, findings: [], embeddingChecked: false,
    });
    expect(computeMemoryHealthScore({ status: {}, embeddingProbe: { ok: false, checked: false } })
      .findings).toEqual([]);
  });

  it("counts a single index failure once and keeps actionable diagnostics", () => {
    const health = computeMemoryHealthScore({
      status: { dirty: true, lastSyncError: "previous failure" }, indexError: "current failure",
      embeddingProbe: { ok: false, error: "model unavailable" },
      ringsAudit: { issues: [{ severity: "warn" }, { severity: "error" }] },
    });
    expect(health.score).toBe(37);
    expect(health.findings.map((item) => item.id)).toEqual([
      "index-error", "embedding-error", "pending-sync", "rings-artifacts",
    ]);
    expect(health.findings[0]?.description).toBe("current failure");
    expect(health.embeddingChecked).toBe(true);
  });

  it("improves after repaired Rings artifacts without changing unrelated evidence", () => {
    const status = { dirty: true };
    expect(computeMemoryHealthScore({ status, ringsAudit: { issues: [{ severity: "warn" }] } })
      .score).toBe(87);
    expect(computeMemoryHealthScore({ status, ringsAudit: { issues: [] } }).score).toBe(97);
  });
});
