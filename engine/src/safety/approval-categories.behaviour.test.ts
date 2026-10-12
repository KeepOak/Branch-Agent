import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_CATEGORIES,
  DEFAULT_SPEND_CAP_USD_PER_TASK,
  describeApprovalRequest,
  findSharedBotCredentials,
  FULL_ACCESS_SETUP_LINE,
  FULL_ACCESS_SHIPPED_ON,
  isFeatureShippedOn,
  resolveCategoryDecision,
  type ApprovalCategory,
} from "./approval-categories.js";

const person = { owner: true, fullAccess: false };
const ownerFull = { owner: true, fullAccess: true };
const decide = (
  category: ApprovalCategory,
  extra: Partial<Parameters<typeof resolveCategoryDecision>[0]> = {},
) => resolveCategoryDecision({ category, caller: person, ...extra }).outcome;

describe("default approval categories (SAFETY-0215)", () => {
  it("R-1755: everything that acts on the world asks first each time", () => {
    for (const category of [
      "send-message",
      "delete-many",
      "spend",
      "install",
      "screen-control",
      "first-open",
      "sign-in",
      "self-modify",
    ] as const) {
      expect(decide(category, { spendUsd: 1 })).toBe("ask");
    }
  });

  it("R-1755: spending is capped at $2 per task by default", () => {
    expect(DEFAULT_SPEND_CAP_USD_PER_TASK).toBe(2);
    expect(decide("spend", { spendUsd: 1.5, spentSoFarUsd: 0.5 })).toBe("ask");
    expect(decide("spend", { spendUsd: 1.5, spentSoFarUsd: 1 })).toBe("deny");
  });

  it("R-2374: reading Documents and Downloads, browsing and recording tasks run without asking", () => {
    for (const category of ["read-documents", "browse", "record-task"] as const) {
      expect(DEFAULT_APPROVAL_CATEGORIES[category]).toBe("without-asking");
      expect(decide(category)).toBe("allow");
    }
  });

  it("R-2375: sending email and messages and installing tools and packages ask", () => {
    expect(decide("send-message")).toBe("ask");
    expect(decide("install")).toBe("ask");
  });

  it("R-2376: Full access is off and never shipped on", () => {
    expect(FULL_ACCESS_SHIPPED_ON).toBe(false);
  });

  it("R-1758: setup says Full access stays off until the person turns it on", () => {
    expect(FULL_ACCESS_SETUP_LINE).toBe("Full access stays off until you turn it on yourself.");
    expect(
      resolveCategoryDecision({ category: "install", caller: { owner: false, fullAccess: true } })
        .outcome,
    ).toBe("ask");
  });

  it("G-1694: only features that spend, send out, delete, use mic/camera, run heavy or loosen safety ship off", () => {
    expect(isFeatureShippedOn([])).toBe(true);
    for (const trait of [
      "spends-money",
      "sends-data-out",
      "deletes",
      "mic-or-camera",
      "heavy-resources",
      "loosens-safety",
    ] as const) {
      expect(isFeatureShippedOn([trait])).toBe(false);
    }
  });

  it("G-1407: password changes, captchas and security warnings go to the owner; camera, downloads, extensions confirm", () => {
    for (const category of ["password-change", "captcha", "security-warning"] as const) {
      expect(decide(category)).toBe("hand-off");
    }
    for (const category of ["camera-mic-location", "download", "extension-install"] as const) {
      expect(decide(category)).toBe("ask");
    }
  });

  it("R-0646: bots wait for approval on delete, purchase and post", () => {
    expect(decide("delete")).toBe("ask");
    expect(decide("purchase", { spendUsd: 1 })).toBe("ask");
    expect(decide("post")).toBe("ask");
  });

  it("G-1408: each bot keeps separate credentials", () => {
    expect(
      findSharedBotCredentials([
        { id: "a", credentialRef: "key-1" },
        { id: "b", credentialRef: "key-1" },
        { id: "c", credentialRef: "key-2" },
      ]),
    ).toEqual(["key-1"]);
  });

  it("R-1320: bots come back only for delete, purchase and post", () => {
    expect(decide("browse")).toBe("allow");
    expect(decide("read-documents")).toBe("allow");
    expect(decide("post")).toBe("ask");
  });

  it("G-1483: delete, purchase and post are approval gates, reading is not", () => {
    expect(
      ["delete", "purchase", "post"].map((c) => DEFAULT_APPROVAL_CATEGORIES[c as ApprovalCategory]),
    ).toEqual(["asks", "asks", "asks"]);
  });

  it("R-1731: the person sees what, which Trunk, which computer and which account before a Yes", () => {
    expect(
      describeApprovalRequest({
        action: "send an email to Ana",
        trunk: "Juniper",
        computer: "the studio Mac",
        account: "work Gmail",
      }),
    ).toBe("Juniper wants to send an email to Ana on the studio Mac, as work Gmail. Allow?");
    expect(decide("send-message")).toBe("ask");
  });

  it("page 03 rule 6: the owner on Full access is asked nothing outside the floor", () => {
    expect(resolveCategoryDecision({ category: "send-message", caller: ownerFull }).outcome).toBe(
      "allow",
    );
    expect(
      resolveCategoryDecision({
        category: "send-message",
        caller: ownerFull,
        floor: new Set(["send-message"]),
      }).outcome,
    ).toBe("ask");
  });
});
