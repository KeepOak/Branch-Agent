import { describe, expect, it } from "vitest";
import { ownerAskFor, OWNER_FLOOR_CHOICES, resolveRuleOutcome } from "./approval-outcomes.js";

const call = { toolName: "message", args: { to: "ana", text: "running late" } };

describe("approval outcomes: hand off to me, only if I asked (SAFETY-0216)", () => {
  it("R-1384: hand off to me prepares the step and gives it to the owner", () => {
    const decision = resolveRuleOutcome({ rule: "hand-off", call });
    expect(decision).toEqual({
      kind: "hand-off",
      prepared: call,
      why: "your rule says you do this step yourself",
    });
  });

  it("R-1384: only if I asked runs when the owner's own message asked for exactly this", () => {
    const asks = [
      ownerAskFor({ toolName: "message", args: { text: "running late", to: "ana" } }, true),
    ];
    expect(resolveRuleOutcome({ rule: "only-if-asked", call, ownerAsks: asks })).toEqual({
      kind: "allow",
      via: "owner-asked",
    });
  });

  it("R-1384: only if I asked escalates, never runs, for different arguments or someone else's message", () => {
    const other = [
      ownerAskFor({ toolName: "message", args: { to: "bo", text: "running late" } }, true),
    ];
    const stranger = [ownerAskFor(call, false)];
    expect(resolveRuleOutcome({ rule: "only-if-asked", call, ownerAsks: other }).kind).toBe("ask");
    expect(resolveRuleOutcome({ rule: "only-if-asked", call, ownerAsks: stranger }).kind).toBe(
      "ask",
    );
  });

  it("R-1384: the password and money floor is optional, off by default, and holds under Full access", () => {
    expect(OWNER_FLOOR_CHOICES).toEqual(["password-change", "move-money"]);
    const base = { rule: "allow" as const, call, ownerFullAccess: true, category: "move-money" };
    expect(resolveRuleOutcome(base).kind).toBe("allow");
    const floor = { enabled: true, categories: new Set(["move-money"]) };
    expect(resolveRuleOutcome({ ...base, floor }).kind).toBe("ask");
  });

  it("R-1384: no new prompts for the owner on Full access beside their own rules", () => {
    expect(resolveRuleOutcome({ rule: "ask", call, ownerFullAccess: true })).toEqual({
      kind: "allow",
      via: "full-access",
    });
    expect(resolveRuleOutcome({ rule: "deny", call, ownerFullAccess: true }).kind).toBe("deny");
    expect(resolveRuleOutcome({ rule: "hand-off", call, ownerFullAccess: true }).kind).toBe(
      "hand-off",
    );
  });
});
