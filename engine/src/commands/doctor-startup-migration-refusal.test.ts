import { describe, expect, it, vi } from "vitest";
import { resolveGatewayStartupMaintenanceReason } from "../cli/gateway-cli/startup-maintenance.js";
import { BranchStateDatabaseSchemaMigrationRequiredError } from "../state/branch-state-db-schema-migration-required.js";
import { rethrowStartupConfigFailure } from "./doctor-startup-migration-refusal.js";

describe("startup refusal handoff", () => {
  it("preserves maintenance classification after the preflight exit", () => {
    const cause = new BranchStateDatabaseSchemaMigrationRequiredError(
      "audit-events-v2",
      "/synthetic/state/branch.sqlite",
    );
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let refusal: unknown;
    try {
      rethrowStartupConfigFailure(cause);
    } catch (error) {
      refusal = error;
    } finally {
      output.mockRestore();
    }
    expect(resolveGatewayStartupMaintenanceReason(refusal)).toBe("state database schema migration");
  });
});
