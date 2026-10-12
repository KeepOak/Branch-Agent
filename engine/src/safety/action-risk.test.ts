// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/security/test_security_risk.py (atlas SAFETY-0016)
// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/security/test_confirmation_policy.py (atlas SAFETY-0016)
import { describe, expect, it } from "vitest";
import {
  SECURITY_RISKS,
  ensembleRisk,
  isRiskier,
  maxRisk,
  parseConfirmationPolicy,
  raiseRisk,
  riskColor,
  riskLessThan,
  shouldConfirm,
  type SecurityRisk,
} from "./action-risk.js";

const CONCRETE: SecurityRisk[] = ["LOW", "MEDIUM", "HIGH"];

describe("SecurityRisk", () => {
  it("test_security_risk_enum_values", () => {
    expect(SECURITY_RISKS).toEqual(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]);
  });

  it("test_riskiness_ordering", () => {
    expect(isRiskier("MEDIUM", "LOW")).toBe(true);
    expect(isRiskier("HIGH", "MEDIUM")).toBe(true);
    expect(isRiskier("HIGH", "LOW")).toBe(true);
    expect(isRiskier("LOW", "MEDIUM")).toBe(false);
    expect(isRiskier("MEDIUM", "HIGH")).toBe(false);
    expect(isRiskier("LOW", "HIGH")).toBe(false);
  });

  it.each(CONCRETE)("test_riskiness_ordering_is_reflexive %s", (risk) => {
    expect(isRiskier(risk, risk)).toBe(true);
  });

  it.each(CONCRETE)("test_riskiness_ordering_non_reflexive %s", (risk) => {
    expect(isRiskier(risk, risk, false)).toBe(false);
  });

  it("test_riskiness_ordering_undefined_for_unknown", () => {
    for (const first of SECURITY_RISKS) {
      for (const second of SECURITY_RISKS) {
        if (first === "UNKNOWN" || second === "UNKNOWN") {
          expect(() => isRiskier(first, second)).toThrow(RangeError);
        } else {
          expect([true, false]).toContain(isRiskier(first, second));
        }
      }
    }
  });

  it("test_security_risk_get_color", () => {
    expect(riskColor("LOW")).toBe("green");
    expect(riskColor("MEDIUM")).toBe("yellow");
    expect(riskColor("HIGH")).toBe("red");
    expect(riskColor("UNKNOWN")).toBe("white");
  });

  it("test_lt_ordering", () => {
    expect(riskLessThan("LOW", "MEDIUM")).toBe(true);
    expect(riskLessThan("MEDIUM", "HIGH")).toBe(true);
    expect(riskLessThan("LOW", "HIGH")).toBe(true);
  });

  it("test_lt_not_less_than_self", () => {
    for (const risk of CONCRETE) {
      expect(riskLessThan(risk, risk)).toBe(false);
    }
  });

  it("test_lt_reverse_ordering", () => {
    expect(riskLessThan("HIGH", "LOW")).toBe(false);
    expect(riskLessThan("HIGH", "MEDIUM")).toBe(false);
    expect(riskLessThan("MEDIUM", "LOW")).toBe(false);
  });

  it("test_lt_unknown_raises", () => {
    expect(() => riskLessThan("UNKNOWN", "LOW")).toThrow(RangeError);
    expect(() => riskLessThan("LOW", "UNKNOWN")).toThrow(RangeError);
    expect(() => riskLessThan("UNKNOWN", "UNKNOWN")).toThrow(RangeError);
  });

  it("test_max_on_concrete_risks", () => {
    expect(maxRisk(["LOW", "MEDIUM", "HIGH"])).toBe("HIGH");
    expect(maxRisk(["LOW", "LOW"])).toBe("LOW");
    expect(maxRisk(["MEDIUM", "HIGH"])).toBe("HIGH");
  });
});

describe("ConfirmationPolicy", () => {
  it.each(SECURITY_RISKS)("test_always_confirm %s", (risk) => {
    expect(shouldConfirm({ kind: "always" }, risk)).toBe(true);
  });

  it.each(SECURITY_RISKS)("test_never_confirm %s", (risk) => {
    expect(shouldConfirm({ kind: "never" }, risk)).toBe(false);
  });

  it("test_roundtrip_serialization", () => {
    for (const policy of [{ kind: "always" }, { kind: "never" }] as const) {
      const stored = JSON.stringify(policy);
      expect(parseConfirmationPolicy(JSON.parse(stored))).toEqual(policy);
    }
    const risky = parseConfirmationPolicy({ kind: "risky", threshold: "MEDIUM" });
    const storedRisky = JSON.stringify(risky);
    expect(parseConfirmationPolicy(JSON.parse(storedRisky))).toEqual(risky);
  });

  it("confirm risky defaults to HIGH and confirms unknown (behaviour)", () => {
    const policy = parseConfirmationPolicy({ kind: "risky" });
    expect(shouldConfirm(policy, "HIGH")).toBe(true);
    expect(shouldConfirm(policy, "MEDIUM")).toBe(false);
    expect(shouldConfirm(policy, "LOW")).toBe(false);
    expect(shouldConfirm(policy, "UNKNOWN")).toBe(true);
    expect(
      shouldConfirm({ kind: "risky", threshold: "MEDIUM", confirmUnknown: false }, "UNKNOWN"),
    ).toBe(false);
    expect(shouldConfirm({ kind: "risky", threshold: "MEDIUM" }, "MEDIUM")).toBe(true);
  });

  it("rejects an UNKNOWN threshold (behaviour)", () => {
    expect(() => parseConfirmationPolicy({ kind: "risky", threshold: "UNKNOWN" })).toThrow(
      "Threshold cannot be UNKNOWN",
    );
  });
});

describe("EnsembleSecurityAnalyzer (behaviour)", () => {
  it("returns the worst concrete risk and filters UNKNOWN", () => {
    expect(ensembleRisk([() => "LOW", () => "HIGH", () => "UNKNOWN"], {})).toBe("HIGH");
    expect(ensembleRisk([() => "UNKNOWN", () => "UNKNOWN"], {})).toBe("UNKNOWN");
  });

  it("propagates UNKNOWN in strict mode", () => {
    expect(ensembleRisk([() => "LOW", () => "UNKNOWN"], {}, { propagateUnknown: true })).toBe(
      "UNKNOWN",
    );
  });

  it("fails closed to HIGH when an analyzer throws", () => {
    const broken = (): SecurityRisk => {
      throw new Error("boom");
    };
    expect(ensembleRisk([() => "LOW", broken], {})).toBe("HIGH");
  });

  it("analysis can raise a declared risk but never lower it", () => {
    expect(raiseRisk("LOW", "HIGH")).toBe("HIGH");
    expect(raiseRisk("HIGH", "LOW")).toBe("HIGH");
    expect(raiseRisk("UNKNOWN", "MEDIUM")).toBe("MEDIUM");
    expect(raiseRisk("MEDIUM", "UNKNOWN")).toBe("MEDIUM");
  });
});
