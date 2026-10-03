import { describe, expect, it } from "vitest";
import { expandPolicyToolRequirement, toolListCoversTool } from "./tool-policy-conformance.js";

describe("policy tool group conformance", () => {
  it("keeps computer control in both node and Branch Agent policy groups", () => {
    expect(expandPolicyToolRequirement("group:nodes")).toEqual(
      expect.arrayContaining(["computer", "mobile_ui"]),
    );
    expect(expandPolicyToolRequirement("group:branch")).toEqual(
      expect.arrayContaining(["computer", "mobile_ui"]),
    );
  });

  it("normalizes aliases and expands groups", () => {
    expect(toolListCoversTool(["bash"], "exec")).toBe(true);
    expect(toolListCoversTool(["apply-patch"], "apply_patch")).toBe(true);
    expect(toolListCoversTool(["cron"], "automations")).toBe(true);
    expect(expandPolicyToolRequirement("cron")).toEqual(["automations"]);
    expect(expandPolicyToolRequirement("group:web")).toEqual([
      "web_search",
      "web_fetch",
      "x_search",
    ]);
  });

  it.each([
    ["fs", "ls"],
    ["runtime", "secrets"],
    ["sessions", "sessions_search"],
    ["ui", "show_widget"],
    ["automation", "automations"],
    ["agents", "skill_workshop"],
    ["media", "view_image"],
  ])("recognizes the core %s group member %s", (group, tool) => {
    expect(toolListCoversTool([`group:${group}`], tool)).toBe(true);
    expect(expandPolicyToolRequirement(`group:${group}`)).toContain(tool);
    if (tool !== "ls") {
      expect(toolListCoversTool(["group:branch"], tool)).toBe(true);
    }
  });

  it("uses the current image tool name in media and Branch Agent groups", () => {
    expect(toolListCoversTool(["group:media", "group:branch"], "image")).toBe(false);
  });

  it("keeps coverage lists restrictive without the runtime write compatibility", () => {
    expect(toolListCoversTool([], "exec")).toBe(false);
    expect(toolListCoversTool(["write"], "apply_patch")).toBe(false);
    expect(toolListCoversTool(["*"], "exec")).toBe(true);
  });

  it("matches wildcard tool requirements", () => {
    expect(toolListCoversTool(["web_*"], "web_search")).toBe(true);
    expect(toolListCoversTool(["web_*"], "memory_search")).toBe(false);
  });
});
