import { describe, expect, it } from "vitest";
import { resolveCliRuntimeToolsAllow, stripBranchMcpToolPrefix } from "./tool-policy.js";

describe("stripBranchMcpToolPrefix", () => {
  it("strips only the loopback transport prefix", () => {
    expect(stripBranchMcpToolPrefix("mcp__branch__memory_search")).toBe("memory_search");
    expect(stripBranchMcpToolPrefix("mcp_branch_memory_search")).toBe("memory_search");
    expect(stripBranchMcpToolPrefix("memory_search")).toBe("memory_search");
    expect(stripBranchMcpToolPrefix("mcp__other__tool")).toBe("mcp__other__tool");
    expect(stripBranchMcpToolPrefix("mcp_other_tool")).toBe("mcp_other_tool");
  });
});

describe("resolveCliRuntimeToolsAllow", () => {
  it("keeps every concrete restriction, including server-managed defaults", () => {
    expect(resolveCliRuntimeToolsAllow(undefined)).toBeUndefined();
    expect(resolveCliRuntimeToolsAllow(["memory_search"], true)).toEqual(["memory_search"]);
    expect(resolveCliRuntimeToolsAllow(["*"])).toBeUndefined();
    expect(resolveCliRuntimeToolsAllow(["memory_search"])).toEqual(["memory_search"]);
  });
});
