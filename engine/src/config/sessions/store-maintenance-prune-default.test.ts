import { describe, expect, it } from "vitest";
import { resolveMaintenanceConfigFromInput } from "./store-maintenance.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("resolveMaintenanceConfigFromInput prune-after default", () => {
  it("treats an unset session.maintenance pruneAfter as never", () => {
    expect(resolveMaintenanceConfigFromInput().pruneAfterMs).toBe(0);
    expect(resolveMaintenanceConfigFromInput({}).pruneAfterMs).toBe(0);
    expect(resolveMaintenanceConfigFromInput({ mode: "enforce" }).pruneAfterMs).toBe(0);
  });

  it("still resolves an explicit pruneAfter of 30 days", () => {
    expect(resolveMaintenanceConfigFromInput({ pruneAfter: "30d" }).pruneAfterMs).toBe(30 * DAY_MS);
  });
});
