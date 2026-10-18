// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { errorText } from "./adapter";

afterEach(() => { localStorage.clear(); });

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

describe("settings errorText never keeps a raw engine dump at Regular", () => {
  it("turns a refused connect into one plain sentence", () => {
    const line = errorText(new Error(ENGINE));
    expect(line).toBe(REACH);
    expect(line).not.toMatch(RAW);
  });

  it("turns an object dump into plain words", () => {
    const line = errorText({ message: "unknown method: logbook.status" });
    expect(line).toBe("This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(line).not.toMatch(RAW);
  });

  it("keeps the exact words save-retry matching uses", () => {
    expect(errorText(new Error("config changed since last load; re-run config.get and retry"))).toContain("config changed since last load");
    expect(errorText("base hash mismatch")).toBe("base hash mismatch");
  });

  it("keeps the exact words at Advanced", () => {
    localStorage.setItem("branch.level", "advanced");
    expect(errorText(new Error(ENGINE))).toBe(ENGINE);
    localStorage.removeItem("branch.level");
  });
});
