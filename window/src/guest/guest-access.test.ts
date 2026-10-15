import { describe, expect, it } from "vitest";
import { createGuestAccess } from "./guest-access";

describe("guest access", () => {
  it("needs consent until the owner allows it", () => {
    const access = createGuestAccess();
    expect(access.state("s").access).toBe("needs-consent");
    access.allow("s");
    expect(access.state("s").access).toBe("allowed");
  });

  it("asks only while consent is missing, and dismisses", () => {
    const access = createGuestAccess();
    access.ask("s");
    expect(access.state("s").asking).toBe(true);
    access.dismiss("s");
    expect(access.state("s")).toEqual({ access: "needs-consent", asking: false });
    access.allow("s");
    access.ask("s");
    expect(access.state("s").asking).toBe(false);
  });

  it("moves between the Trunk and the owner", () => {
    const access = createGuestAccess();
    access.allow("s");
    access.takeOver("s");
    expect(access.state("s").access).toBe("owner-control");
    access.handBack("s");
    expect(access.state("s").access).toBe("allowed");
  });

  it("keeps conversations apart and notifies listeners with a new state object", () => {
    const access = createGuestAccess();
    let calls = 0;
    const off = access.subscribe(() => calls++);
    const before = access.state("a");
    access.allow("a");
    expect(calls).toBe(1);
    expect(access.state("a")).not.toBe(before);
    expect(access.state("b").access).toBe("needs-consent");
    off();
    access.allow("b");
    expect(calls).toBe(1);
  });
});
