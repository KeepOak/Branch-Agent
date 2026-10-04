export type MemoryHealthFinding = {
  id: string;
  severity: "critical" | "warning" | "info";
  description: string;
};

type MemoryHealthEvidence = {
  status: { dirty?: boolean; lastSyncError?: string };
  indexError?: string;
  embeddingProbe?: { ok: boolean; checked?: boolean; error?: string };
  ringsAudit?: { issues: readonly { severity: string }[] };
};

// Severity deductions follow the upstream memory health score. Checks use
// observed engine failures rather than assuming file or context size limits.
const DEDUCTIONS = { critical: 20, warning: 10, info: 3 } as const;

export function computeMemoryHealthScore(evidence: MemoryHealthEvidence) {
  const findings: MemoryHealthFinding[] = [];
  const syncError = evidence.indexError ?? evidence.status.lastSyncError;
  if (syncError) {
    findings.push({ id: "index-error", severity: "critical", description: syncError });
  }
  const probe = evidence.embeddingProbe;
  if (probe && probe.checked !== false && !probe.ok) {
    findings.push({
      id: "embedding-error", severity: "critical",
      description: probe.error ?? "Embedding availability probe failed.",
    });
  }
  if (evidence.status.dirty) {
    findings.push({
      id: "pending-sync", severity: "info", description: "Memory changes await indexing.",
    });
  }
  const issues = evidence.ringsAudit?.issues ?? [];
  if (issues.length) {
    findings.push({
      id: "rings-artifacts",
      severity: issues.some((issue) => issue.severity === "error") ? "critical" : "warning",
      description: `${issues.length} Rings artifact issue(s) require review.`,
    });
  }
  const score = Math.max(0, 100 - findings.reduce((sum, item) => sum + DEDUCTIONS[item.severity], 0));
  return { score, findings, embeddingChecked: Boolean(probe && probe.checked !== false) };
}
