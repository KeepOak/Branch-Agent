// Written by Branch (atlas RESEARCH-0001), not copied: verify new Harvest research tools pass the existing shared before-tool-call policy before resolving credentials or dispatching network effects.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBraveImageSearchTool } from "../../extensions/brave/src/brave-image-search-tool.js";
import { createTavilyCrawlTool } from "../../extensions/tavily/src/tavily-crawl-tool.js";
import { createTavilyMapTool } from "../../extensions/tavily/src/tavily-map-tool.js";
import { createTestPluginApi } from "../plugin-sdk/plugin-test-api.js";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../plugins/hook-runner-global.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { bindAssembledAgentToolActionDescriptor } from "./agent-tool-metadata.js";
import { wrapToolWithBeforeToolCallHook } from "./agent-tools.before-tool-call.js";

afterEach(() => {
  resetGlobalHookRunner();
  setActivePluginRegistry(createEmptyPluginRegistry());
  vi.unstubAllGlobals();
});

describe("Harvest research tools use the shared safety layer", () => {
  it.each([
    { name: "brave_image_search", create: createBraveImageSearchTool, params: { query: "test" } },
    { name: "tavily_crawl", create: createTavilyCrawlTool, params: { url: "https://example.com" } },
    { name: "tavily_map", create: createTavilyMapTool, params: { url: "https://example.com" } },
  ])("blocks $name before its credential and HTTP owners", async ({ name, create, params }) => {
    const registry = createEmptyPluginRegistry();
    const evaluate = vi.fn(() => ({ block: true, blockReason: "owner policy denied" }));
    registry.trustedToolPolicies = [
      {
        pluginId: "owner-policy",
        source: "test",
        policy: { id: "harvest-policy", description: "shared policy", evaluate },
      },
    ];
    setActivePluginRegistry(registry);
    initializeGlobalHookRunner(registry);
    const getRuntimeConfig = vi.fn(() => ({}));
    const source = create(createTestPluginApi({ config: {} }), { getRuntimeConfig });
    bindAssembledAgentToolActionDescriptor(source);
    const tool = wrapToolWithBeforeToolCallHook(source, {
      agentId: "main",
      sessionKey: "agent:main:harvest",
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(source.name).toBe(name);
    expect(await tool.execute("blocked", params)).toMatchObject({ details: { status: "blocked" } });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(getRuntimeConfig).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
