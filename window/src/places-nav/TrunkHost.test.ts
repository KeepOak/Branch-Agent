import { describe, expect, it } from "vitest";
import { readOpenTrunk } from "./TrunkHost";

// A Trunk's model setting opens its editor on the "What it may do" tab, so Models stays the place the person is in.
describe("branch:open-trunk requests", () => {
  it("opens the editor on the tab it names", () => {
    expect(readOpenTrunk({ agentId: "research-desk", view: "edit", tab: "may" })).toEqual({ agentId: "research-desk", view: "edit", tab: "may" });
  });

  it("ignores a tab that is not an editor tab, and a tab on a profile", () => {
    expect(readOpenTrunk({ agentId: "a", view: "edit", tab: "nope" })).toEqual({ agentId: "a", view: "edit" });
    expect(readOpenTrunk({ agentId: "a", view: "profile", tab: "may" })).toEqual({ agentId: "a", view: "profile" });
  });

  it("keeps the old shape working with no tab", () => {
    expect(readOpenTrunk({ agentId: "a", view: "edit" })).toEqual({ agentId: "a", view: "edit" });
    expect(readOpenTrunk({})).toBeNull();
  });
});
