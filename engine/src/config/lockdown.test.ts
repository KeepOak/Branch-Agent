import { describe, expect, it } from "vitest";
import { isLockdownSwitchPatch } from "./lockdown-policy.js";

describe("Lockdown switch patch", () => {
  it("admits only the single global switch", () => {
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":true}}' })).toBe(true);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false}}' })).toBe(true);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false,"audit":{}}}' })).toBe(false);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false},"tools":{}}' })).toBe(false);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":null}}' })).toBe(false);
  });
});
