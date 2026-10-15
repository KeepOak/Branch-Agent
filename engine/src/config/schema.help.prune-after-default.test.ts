import { describe, expect, it } from "vitest";
import { FIELD_HELP } from "./schema.help.js";
import { resolveMaintenanceConfigFromInput } from "./sessions/store-maintenance.js";

describe("session.maintenance.pruneAfter help", () => {
  it("documents the unset default as keep forever", () => {
    expect(resolveMaintenanceConfigFromInput().pruneAfterMs).toBe(0);
    const help = FIELD_HELP["session.maintenance.pruneAfter"];
    expect(help).toMatch(/forever/i);
    expect(help).not.toMatch(/default `30d`/i);
  });
});
