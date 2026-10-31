import { describe, expect, it } from "vitest";
import { GATEWAY_OWNER_PROFILE_ID } from "../../../packages/gateway-protocol/src/schema/user-profile-constants.js";
import { isLoneSharedOwner } from "./presence-users.ts";

describe("isLoneSharedOwner", () => {
  it("is true only when the owner's key is the single online connection", () => {
    expect(isLoneSharedOwner([{ id: GATEWAY_OWNER_PROFILE_ID }])).toBe(true);
    expect(isLoneSharedOwner([])).toBe(false);
    expect(isLoneSharedOwner([{ id: "profile-ada", name: "Ada" }])).toBe(false);
    expect(
      isLoneSharedOwner([{ id: GATEWAY_OWNER_PROFILE_ID }, { id: "profile-ada", name: "Ada" }]),
    ).toBe(false);
  });
});
