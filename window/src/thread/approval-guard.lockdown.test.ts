import { describe, expect, it } from "vitest";
import { lockdownAllowsAnswer } from "./approval-guard";

describe("approval answers under Lockdown (preview index.html:18528-18533)", () => {
  it("lets Don't through and refuses every allow", () => {
    expect(lockdownAllowsAnswer(true, "deny")).toBe(true);
    expect(lockdownAllowsAnswer(true, "allow-once")).toBe(false);
    expect(lockdownAllowsAnswer(true, "allow-always")).toBe(false);
  });

  it("lets everything through when Lockdown is off", () => {
    expect(lockdownAllowsAnswer(false, "allow-once")).toBe(true);
    expect(lockdownAllowsAnswer(undefined, "allow-always")).toBe(true);
  });
});
