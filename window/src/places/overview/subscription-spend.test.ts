import { describe, expect, it } from "vitest";
import type { Resource } from "./engine";
import { payPerUse } from "./index";

const loaded = (value: unknown): Resource => ({ value } as Resource);

describe("Overview spend on plans", () => {
  it("is unknown until the accounts load, then tells plans from pay-per-use keys", () => {
    expect(payPerUse({ loading: true } as Resource)).toBeUndefined();
    expect(payPerUse(loaded({ providers: [{ profiles: [{ type: "oauth" }, { type: "token" }] }] }))).toBe(false);
    expect(payPerUse(loaded({ providers: [{ profiles: [{ type: "oauth" }] }, { profiles: [{ type: "api_key" }] }] }))).toBe(true);
    expect(payPerUse(loaded({ providers: [] }))).toBeUndefined();
  });
});
