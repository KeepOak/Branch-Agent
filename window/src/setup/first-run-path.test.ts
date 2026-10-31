import { describe, expect, it } from "vitest";
import { askedForFirstRun } from "./first-run-path";

describe("askedForFirstRun", () => {
  it("opens the first-run screen at /onboarding and /welcome", () => {
    expect(askedForFirstRun({ pathname: "/onboarding", hash: "" })).toBe(true);
    expect(askedForFirstRun({ pathname: "/welcome/", hash: "" })).toBe(true);
    expect(askedForFirstRun({ pathname: "/Welcome", hash: "" })).toBe(true);
  });

  it("accepts the hash form a file:// window uses", () => {
    expect(askedForFirstRun({ pathname: "/index.html", hash: "#/onboarding" })).toBe(true);
    expect(askedForFirstRun({ pathname: "/", hash: "#welcome" })).toBe(true);
  });

  it("leaves every other address on the saved conversation", () => {
    expect(askedForFirstRun({ pathname: "/", hash: "" })).toBe(false);
    expect(askedForFirstRun({ pathname: "/index.html", hash: "" })).toBe(false);
    expect(askedForFirstRun({ pathname: "/welcomes", hash: "#/settings" })).toBe(false);
    expect(askedForFirstRun(undefined)).toBe(false);
  });
});
