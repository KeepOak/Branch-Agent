import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:integrations/tavily/src/__tests__/map.test.ts (atlas RESEARCH-0003). Adapted to native tool metadata and guarded HTTP owner; all source cases retained.
import { describe, it, expect, vi, beforeEach } from "vitest";
const { mockMap } = vi.hoisted(() => ({ mockMap: vi.fn() }));
vi.mock("./tavily-client.js", () => ({ runTavilyDiscovery: mockMap }));
import { createTavilyMapTool } from "./tavily-map-tool.js";

describe("createTavilyMapTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMap.mockResolvedValue({
      baseUrl: "https://example.com",
      results: [
        "https://example.com/about",
        "https://example.com/blog",
        "https://example.com/docs",
        "https://example.com/pricing",
      ],
      responseTime: 1.2,
    });
  });

  it("should create a tool with correct id", () => {
    const tool = createTavilyMapTool(createTestPluginApi({ config: {} }));
    expect(tool.name).toBe("tavily_map");
    expect(tool.description).toBeDefined();
  });

  it("should have inputSchema and outputSchema", () => {
    const tool = createTavilyMapTool(createTestPluginApi({ config: {} }));
    expect(tool.parameters).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it("should call client.map with mapped parameters", async () => {
    const tool = createTavilyMapTool(createTestPluginApi({ config: {} }));

    const result = await tool.execute("call", {
      url: "https://example.com",
      maxDepth: 2,
      maxBreadth: 15,
      limit: 100,
      allowExternal: false,
    });

    expect(mockMap).toHaveBeenCalledWith("map", {
      cfg: {},
      url: "https://example.com",
      maxDepth: 2,
      maxBreadth: 15,
      limit: 100,
      instructions: undefined,
      selectPaths: undefined,
      selectDomains: undefined,
      excludePaths: undefined,
      excludeDomains: undefined,
      allowExternal: false,
    });

    expect(result.details).toEqual({
      baseUrl: "https://example.com",
      results: [
        "https://example.com/about",
        "https://example.com/blog",
        "https://example.com/docs",
        "https://example.com/pricing",
      ],
      responseTime: 1.2,
    });
  });

  it("should handle empty results", async () => {
    mockMap.mockResolvedValue({
      baseUrl: "https://empty-site.com",
      results: [],
      responseTime: 0.3,
    });

    const tool = createTavilyMapTool(createTestPluginApi({ config: {} }));
    const result = (await tool.execute("call", { url: "https://empty-site.com" })).details;

    expect(result.results).toEqual([]);
  });

  it("should let errors propagate", async () => {
    mockMap.mockRejectedValue(new Error("DNS resolution failed"));

    const tool = createTavilyMapTool(createTestPluginApi({ config: {} }));
    await expect(tool.execute("call", { url: "https://nonexistent.com" })).rejects.toThrow(
      "DNS resolution failed",
    );
  });
});
