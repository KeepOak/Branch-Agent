import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:integrations/tavily/src/__tests__/crawl.test.ts (atlas RESEARCH-0003). Adapted to native tool metadata and guarded HTTP owner; all source cases retained.
import { describe, it, expect, vi, beforeEach } from "vitest";
const { mockCrawl } = vi.hoisted(() => ({ mockCrawl: vi.fn() }));
vi.mock("./tavily-client.js", () => ({ runTavilyDiscovery: mockCrawl }));
import { createTavilyCrawlTool } from "./tavily-crawl-tool.js";

describe("createTavilyCrawlTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCrawl.mockResolvedValue({
      baseUrl: "https://docs.example.com",
      results: [
        {
          url: "https://docs.example.com/getting-started",
          rawContent: "# Getting Started\nWelcome to the docs.",
        },
        {
          url: "https://docs.example.com/api",
          rawContent: "# API Reference\nEndpoints documented here.",
          images: ["https://docs.example.com/diagram.png"],
        },
      ],
      responseTime: 5.3,
    });
  });

  it("should create a tool with correct id", () => {
    const tool = createTavilyCrawlTool(createTestPluginApi({ config: {} }));
    expect(tool.name).toBe("tavily_crawl");
    expect(tool.description).toBeDefined();
  });

  it("should have inputSchema and outputSchema", () => {
    const tool = createTavilyCrawlTool(createTestPluginApi({ config: {} }));
    expect(tool.parameters).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it("should call client.crawl with all parameters", async () => {
    const tool = createTavilyCrawlTool(createTestPluginApi({ config: {} }));

    const result = await tool.execute("call", {
      url: "https://docs.example.com",
      maxDepth: 3,
      maxBreadth: 10,
      limit: 50,
      instructions: "Only crawl documentation pages",
      selectPaths: ["/docs/.*"],
      selectDomains: ["^docs\\.example\\.com$"],
      allowExternal: false,
      extractDepth: "advanced",
    });

    expect(mockCrawl).toHaveBeenCalledWith("crawl", {
      cfg: {},
      url: "https://docs.example.com",
      maxDepth: 3,
      maxBreadth: 10,
      limit: 50,
      instructions: "Only crawl documentation pages",
      selectPaths: ["/docs/.*"],
      selectDomains: ["^docs\\.example\\.com$"],
      excludePaths: undefined,
      excludeDomains: undefined,
      allowExternal: false,
      extractDepth: "advanced",
      includeImages: undefined,
      format: undefined,
    });

    expect(result.details).toEqual({
      baseUrl: "https://docs.example.com",
      results: [
        {
          url: "https://docs.example.com/getting-started",
          rawContent: "# Getting Started\nWelcome to the docs.",
          images: undefined,
        },
        {
          url: "https://docs.example.com/api",
          rawContent: "# API Reference\nEndpoints documented here.",
          images: ["https://docs.example.com/diagram.png"],
        },
      ],
      responseTime: 5.3,
    });
  });

  it("should let errors propagate", async () => {
    mockCrawl.mockRejectedValue(new Error("Crawl timeout"));

    const tool = createTavilyCrawlTool(createTestPluginApi({ config: {} }));
    await expect(tool.execute("call", { url: "https://huge-site.com" })).rejects.toThrow(
      "Crawl timeout",
    );
  });
});
