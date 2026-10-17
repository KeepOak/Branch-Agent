import { describe, expect, it } from "vitest";
import { PERSON_FALLBACK, personName } from "./person-name";

describe("one name rule", () => {
  it("prefers the display name, then the GitHub login, then the email's local part", () => {
    expect(personName({ displayName: " Taofik Bishi ", githubIdentity: { login: "stabrea" }, emails: ["x@example.test"] })).toBe("Taofik Bishi");
    expect(personName({ githubIdentity: { login: "stabrea" }, emails: ["x@example.test"] })).toBe("stabrea");
    expect(personName({ emails: ["dana.lee@example.test"] })).toBe("dana.lee");
  });
  it("never says Owner: with nothing to show, the owner reads You", () => {
    expect(personName({}, "gateway-owner")).toBe(PERSON_FALLBACK);
    expect(personName(null, "gateway-owner")).toBe("You");
    expect(personName({}, "gateway-owner")).not.toBe("Owner");
  });
  it("gives anyone else their id when nothing else is known", () => {
    expect(personName({}, "person-7")).toBe("person-7");
  });
});
