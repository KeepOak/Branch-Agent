// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { errorText } from "./adapter";

afterEach(() => { localStorage.clear(); });

const RAW = /TypeError|Cannot read propert|undefined/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";

describe("settings errorText plains dumps except words other settings code still matches", () => {
  it("turns a TypeError dump into one plain sentence", () => {
    const line = errorText(new Error("TypeError: Cannot read properties of undefined (reading 'hash')"));
    expect(line).toBe("That didn’t work. Try again.");
    expect(line).not.toMatch(RAW);
  });

  it("keeps the exact words save-retry matching uses", () => {
    expect(errorText(new Error("config changed since last load; re-run config.get and retry"))).toContain("config changed since last load");
    expect(errorText("base hash mismatch")).toBe("base hash mismatch");
  });

  it("keeps unknown method, invalid-value and connect dumps for matchers and lead re-wraps", () => {
    expect(errorText(new Error("unknown method: logbook.status"))).toBe("unknown method: logbook.status");
    expect(errorText(new Error("security.lockdown: Expected boolean"))).toBe("security.lockdown: Expected boolean");
    expect(errorText(new Error(ENGINE))).toBe(ENGINE);
  });

  it("keeps the exact words at Advanced", () => {
    localStorage.setItem("branch.level", "advanced");
    expect(errorText(new Error("TypeError: Cannot read properties of undefined"))).toBe("TypeError: Cannot read properties of undefined");
    localStorage.removeItem("branch.level");
  });
});
