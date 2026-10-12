// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/security/risk.py (atlas SAFETY-0016)
// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/security/confirmation_policy.py (atlas SAFETY-0016)
// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/security/ensemble.py (atlas SAFETY-0016)
//
// Risk levels on every action. Analyzers can only raise a level; the
// confirmation policy (always / never / only risky) says what pauses. The
// owner's Full-access path keeps its own rule (page 03 rule 6): this module
// only reports, it is consumed by the existing before-tool-call policy.

export type SecurityRisk = "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
export const SECURITY_RISKS: readonly SecurityRisk[] = ["UNKNOWN", "LOW", "MEDIUM", "HIGH"];

const RISK_ORDER: Record<Exclude<SecurityRisk, "UNKNOWN">, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

const RISK_DESCRIPTIONS: Record<SecurityRisk, string> = {
  LOW: "Low risk - Safe operation with minimal security impact",
  MEDIUM: "Medium risk - Moderate security impact, review recommended",
  HIGH: "High risk - Significant security impact, confirmation required",
  UNKNOWN: "Unknown risk - Risk level could not be determined",
};

const RISK_COLORS: Record<SecurityRisk, string> = {
  LOW: "green",
  MEDIUM: "yellow",
  HIGH: "red",
  UNKNOWN: "white",
};

export function describeRisk(risk: SecurityRisk): string {
  return RISK_DESCRIPTIONS[risk];
}

export function riskColor(risk: SecurityRisk): string {
  return RISK_COLORS[risk];
}

function order(risk: SecurityRisk): number {
  if (risk === "UNKNOWN") {
    throw new RangeError("Cannot compare unknown risk levels.");
  }
  return RISK_ORDER[risk];
}

/** True when a is riskier than b; reflexive by default. Throws for UNKNOWN. */
export function isRiskier(a: SecurityRisk, b: SecurityRisk, reflexive = true): boolean {
  const left = order(a);
  const right = order(b);
  return left > right || (reflexive && a === b);
}

/** Strict ordering LOW < MEDIUM < HIGH. Throws for UNKNOWN. */
export function riskLessThan(a: SecurityRisk, b: SecurityRisk): boolean {
  return order(a) < order(b);
}

/** Highest of concrete risks. Throws for an empty list or UNKNOWN entries. */
export function maxRisk(risks: readonly SecurityRisk[]): SecurityRisk {
  if (risks.length === 0) {
    throw new RangeError("maxRisk needs at least one risk.");
  }
  return risks.reduce((best, risk) => (riskLessThan(best, risk) ? risk : best));
}

export type ConfirmationPolicy =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "risky"; threshold?: Exclude<SecurityRisk, "UNKNOWN">; confirmUnknown?: boolean };

/** Validates a policy read from config; UNKNOWN is never a valid threshold. */
export function parseConfirmationPolicy(value: unknown): ConfirmationPolicy {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (record.kind === "always" || record.kind === "never") {
    return { kind: record.kind };
  }
  if (record.kind !== "risky") {
    throw new TypeError("Unknown confirmation policy kind.");
  }
  const threshold = record.threshold ?? "HIGH";
  if (threshold !== "LOW" && threshold !== "MEDIUM" && threshold !== "HIGH") {
    throw new TypeError("Threshold cannot be UNKNOWN");
  }
  const confirmUnknown = typeof record.confirmUnknown === "boolean" ? record.confirmUnknown : true;
  return { kind: "risky", threshold, confirmUnknown };
}

/** Whether an action at this risk pauses for confirmation under the policy. */
export function shouldConfirm(policy: ConfirmationPolicy, risk: SecurityRisk = "UNKNOWN"): boolean {
  if (policy.kind === "always") {
    return true;
  }
  if (policy.kind === "never") {
    return false;
  }
  if (risk === "UNKNOWN") {
    return policy.confirmUnknown ?? true;
  }
  return isRiskier(risk, policy.threshold ?? "HIGH");
}

export type RiskAnalyzer<TAction> = (action: TAction) => SecurityRisk;

/**
 * Worst-case fusion across analyzers. A throwing analyzer counts as HIGH
 * (fail closed). UNKNOWN is dropped when any analyzer gave a concrete level,
 * unless propagateUnknown is set.
 */
export function ensembleRisk<TAction>(
  analyzers: readonly RiskAnalyzer<TAction>[],
  action: TAction,
  options: { propagateUnknown?: boolean } = {},
): SecurityRisk {
  if (analyzers.length === 0) {
    throw new RangeError("ensembleRisk needs at least one analyzer.");
  }
  const results = analyzers.map((analyzer) => {
    try {
      return analyzer(action);
    } catch {
      return "HIGH" as const;
    }
  });
  if (options.propagateUnknown && results.includes("UNKNOWN")) {
    return "UNKNOWN";
  }
  const concrete = results.filter((risk) => risk !== "UNKNOWN");
  return concrete.length === 0 ? "UNKNOWN" : maxRisk(concrete);
}

/** A declared risk can only be raised by analysis, never lowered. */
export function raiseRisk(declared: SecurityRisk, analyzed: SecurityRisk): SecurityRisk {
  if (declared === "UNKNOWN") {
    return analyzed;
  }
  if (analyzed === "UNKNOWN") {
    return declared;
  }
  return maxRisk([declared, analyzed]);
}
