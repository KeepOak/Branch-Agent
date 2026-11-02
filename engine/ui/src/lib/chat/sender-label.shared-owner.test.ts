import { describe, expect, it } from "vitest";
import { isSharedOwnerSender } from "./sender-label.ts";

describe("isSharedOwnerSender", () => {
  it("recognises the owner's key by profile identity or bare id", () => {
    expect(isSharedOwnerSender({ identity: { type: "profile", id: "gateway-owner" } })).toBe(true);
    expect(isSharedOwnerSender({ id: "gateway-owner" })).toBe(true);
  });

  it("leaves people and missing senders alone", () => {
    expect(isSharedOwnerSender({ identity: { type: "profile", id: "profile-ada" } })).toBe(false);
    expect(isSharedOwnerSender({ id: "ada@example.test", name: "Ada" })).toBe(false);
    expect(isSharedOwnerSender(null)).toBe(false);
  });
});
