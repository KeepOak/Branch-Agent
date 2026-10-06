// Written by Branch for atlas OPS-0208 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/config/validation-core.ts and src/config/schema.help.ts; no upstream tests were recorded for this row.
import { describe, expect, it } from "vitest";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";
import { validateConfigObjectRaw } from "./validation.js";

describe("config validation with field help (OPS-0208)", () => {
  it.each([
    { config: { gatewy: {} }, path: "", key: "gatewy" },
    { config: { gateway: { prt: 18789 } }, path: "gateway", key: "prt" },
  ])("reports an unknown $key at its config path", ({ config, path, key }) => {
    const result = validateConfigObjectRaw(config);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Unknown config keys must fail validation");
    }
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path, message: expect.stringContaining(key) }),
      ]),
    );
  });

  it("reports a typed field error and supplies its label and help", () => {
    const result = validateConfigObjectRaw({ gateway: { port: "not-a-port" } });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("A nonnumeric gateway port must fail validation");
    }
    const issue = result.issues.find((entry) => entry.path === "gateway.port");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("number");
    expect(FIELD_LABELS["gateway.port"]).toEqual(expect.any(String));
    expect(FIELD_LABELS["gateway.port"].trim().length).toBeGreaterThan(0);
    expect(FIELD_HELP["gateway.port"]).toEqual(expect.any(String));
    expect(FIELD_HELP["gateway.port"].trim().length).toBeGreaterThan(0);
  });

  it("accepts a valid config without coercing its authored port", () => {
    const result = validateConfigObjectRaw({ gateway: { port: 18789 } });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("A valid gateway port must pass validation");
    }
    expect(result.config.gateway?.port).toBe(18789);
  });
});
