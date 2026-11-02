import { describe, expect, it } from "vitest";
import { connectedNow } from "./presence";

describe("connectedNow", () => {
  it("a computer's node entry decides, even when its paired record says connected", () => {
    expect(connectedNow({ connected: true }, { connected: false })).toBe(false);
    expect(connectedNow({ connected: false }, { connected: true })).toBe(true);
  });

  it("a paired device with no node entry follows its own flag", () => {
    expect(connectedNow({ connected: true }, undefined)).toBe(true);
    expect(connectedNow({ connected: false }, undefined)).toBe(false);
    expect(connectedNow(undefined, undefined)).toBe(false);
  });
});
