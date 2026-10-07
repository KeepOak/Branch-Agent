import { describe, expect, it } from "vitest";
import { withOwner } from "./agent-owner";

describe("withOwner", () => {
  it("adds the default Trunk to owned calls that name none", () => {
    expect(withOwner("skills.proposals.list", {}, "tk")).toEqual({ agentId: "tk" });
    expect(withOwner("skills.proposals.list", undefined, "tk")).toEqual({ agentId: "tk" });
    expect(withOwner("memory.search", { query: "x", agentId: "" }, "tk")).toEqual({ query: "x", agentId: "tk" });
    expect(withOwner("models.authStatus", {}, "tk")).toEqual({ agentId: "tk" });
  });

  it("names the Trunk on skills, tools, hooks and every doctor.memory call", () => {
    for (const m of ["skills.status", "tools.catalog", "hooks.status", "doctor.memory.status", "doctor.memory.dreamDiary", "doctor.memory.resetGroundedShortTerm"]) {
      expect(withOwner(m, {}, "tk")).toEqual({ agentId: "tk" });
    }
    expect(withOwner("tools.catalog", { includePlugins: true }, "tk")).toEqual({ includePlugins: true, agentId: "tk" });
  });

  it("keeps a picked Trunk and leaves other methods alone", () => {
    expect(withOwner("skills.proposals.list", { agentId: "dev" }, "tk")).toEqual({ agentId: "dev" });
    expect(withOwner("sessions.list", {}, "tk")).toEqual({});
    expect(withOwner("models.authStatus", {}, undefined)).toEqual({});
  });
});
