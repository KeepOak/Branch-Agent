// Covers loopback logging exposure audit findings.
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { withEnvAsync } from "../test-utils/env.js";
import { collectSecurityAuditFindings } from "./audit.test-support.js";
import type { SecurityAuditFinding } from "./audit.types.js";

function hasGatewayFinding(
  checkId: "gateway.trusted_proxies_missing" | "gateway.loopback_no_auth",
  severity: "warn" | "critical",
  findings: SecurityAuditFinding[],
) {
  return findings.some((finding) => finding.checkId === checkId && finding.severity === severity);
}

function hasLoggingFinding(
  checkId: "logging.redact_off",
  severity: "warn",
  findings: SecurityAuditFinding[],
) {
  return findings.some((finding) => finding.checkId === checkId && finding.severity === severity);
}

describe("security audit loopback and logging findings", () => {
  it("evaluates loopback control UI and logging exposure findings", async () => {
    await Promise.all([
      (async () => {
        const cfg: BranchConfig = {
          agents: { entries: { main: {} } },
          gateway: {
            bind: "loopback",
            controlUi: { enabled: true },
          },
        };
        expect(
          hasGatewayFinding(
            "gateway.trusted_proxies_missing",
            "warn",
            await collectSecurityAuditFindings(cfg),
          ),
        ).toBe(true);
      })(),
      withEnvAsync(
        {
          BRANCH_GATEWAY_TOKEN: undefined,
          BRANCH_GATEWAY_PASSWORD: undefined,
        },
        async () => {
          const cfg: BranchConfig = {
            agents: { entries: { main: {} } },
            gateway: {
              bind: "loopback",
              controlUi: { enabled: true },
              auth: {},
            },
          };
          expect(
            hasGatewayFinding(
              "gateway.loopback_no_auth",
              "critical",
              await collectSecurityAuditFindings(cfg),
            ),
          ).toBe(true);
        },
      ),
      (async () => {
        const cfg: BranchConfig = {};
        expect(
          hasLoggingFinding("logging.redact_off", "warn", await collectSecurityAuditFindings(cfg)),
        ).toBe(false);
      })(),
    ]);
  });
});
