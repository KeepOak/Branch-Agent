import { describe, expect, it } from "vitest";
import { computeBaseConfigSchemaResponse } from "./schema-base.js";
import { BranchSchema } from "./zod-schema.js";

describe("BranchSchema telemetry config", () => {
  it("keeps feature statistics absent by default and preserves explicit consent decisions", () => {
    expect(BranchSchema.parse({}).telemetry).toBeUndefined();

    for (const enabled of [false, true]) {
      const telemetry = { enabled, consentedAt: "2026-08-23T12:00:00.000Z" };
      expect(BranchSchema.parse({ telemetry }).telemetry).toStrictEqual(telemetry);
    }
  });

  it("rejects unknown telemetry fields and malformed consent timestamps", () => {
    expect(
      BranchSchema.safeParse({ telemetry: { enabled: true, installId: "hidden" } }).success,
    ).toBe(false);
    expect(
      BranchSchema.safeParse({ telemetry: { consentedAt: "not-a-timestamp" } }).success,
    ).toBe(false);
  });

  it("projects schema-owned labels, help, docs, and the existing configuration tier", () => {
    const response = computeBaseConfigSchemaResponse({ generatedAt: "telemetry-metadata" });
    expect(response.uiHints["telemetry.enabled"]).toMatchObject({
      label: "Anonymous Feature Statistics",
      help: expect.stringContaining("Disabled by default"),
    });
    expect(response.uiHints["telemetry.consentedAt"]).toMatchObject({
      label: "Feature Statistics Consent Timestamp",
      help: expect.stringContaining("ISO timestamp"),
    });

    expect(response.uiHints.telemetry?.docsUrl).toBe("https://docs.openclaw.ai/gateway/telemetry");
    expect(response.uiHints["telemetry.enabled"]?.advanced).toBe(true);
  });
});
