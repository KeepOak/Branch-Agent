import { describe, expect, it } from "vitest";
import { pairingConfirmCode } from "./confirm-code.js";

describe("pairingConfirmCode", () => {
  it("returns six unambiguous characters from any seed", () => {
    expect(pairingConfirmCode("setup-123")).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/u);
    expect(pairingConfirmCode("setup-123")).toBe("F2S4KP");
    expect(pairingConfirmCode("s1")).toBe("9M36D8");
    expect(pairingConfirmCode("setup-123")).toBe(pairingConfirmCode("setup-123"));
    expect(pairingConfirmCode("setup-123")).not.toBe(pairingConfirmCode("setup-124"));
    expect(pairingConfirmCode("")).toHaveLength(6);
  });

  it("never includes I, L, O or U", () => {
    for (const seed of ["setup-1", "abc", "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "ILU"]) {
      expect(pairingConfirmCode(seed)).not.toMatch(/[ILOU]/u);
    }
  });
});
