import { describe, expect, it } from "vitest";
import { decideLockdownAdmission } from "../../config/lockdown-policy.js";

const owner = () => true;

describe("team methods under Lockdown", () => {
  it("refuses trunks.team.approve, the write that creates Trunks, rooms and jobs", () => {
    expect(
      decideLockdownAdmission({
        method: "trunks.team.approve",
        params: { goal: "x", proposalHash: "h" },
        scope: "operator.write",
        isOwner: owner,
      }),
    ).toEqual({ admitted: false, reason: "locked" });
  });

  it("refuses an allow on the approve card, so the change cannot be applied", () => {
    expect(
      decideLockdownAdmission({
        method: "approval.resolve",
        params: { decision: "allow-once" },
        scope: "operator.write",
        isOwner: owner,
      }),
    ).toEqual({ admitted: false, reason: "locked" });
  });

  it("keeps trunks.team.propose available, since it only reads configuration", () => {
    expect(
      decideLockdownAdmission({
        method: "trunks.team.propose",
        params: { goal: "x" },
        scope: "operator.read",
        isOwner: owner,
      }),
    ).toEqual({ admitted: true });
  });
});
