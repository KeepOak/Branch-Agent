import { describe, expect, it } from "vitest";
import { resolveOwnerDisplayName } from "./user-identity.ts";

describe("resolveOwnerDisplayName", () => {
  it("prefers the signed-in name, then email, then the name set on this computer", () => {
    expect(
      resolveOwnerDisplayName({ name: "Taylor", email: "x@example.test" }, { name: "Local" }),
    ).toBe("Taylor");
    expect(
      resolveOwnerDisplayName({ name: null, email: "x@example.test" }, { name: "Local" }),
    ).toBe("x@example.test");
    expect(resolveOwnerDisplayName(null, { name: " Local " })).toBe("Local");
    expect(resolveOwnerDisplayName(null, null)).toBeNull();
  });
});
