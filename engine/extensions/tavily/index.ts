// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/tavily/index.ts (atlas RESEARCH-0003). Changed for Branch: register Mastra crawl/map through native tool factories.
import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createTavilyCrawlTool } from "./src/tavily-crawl-tool.js";
import { createTavilyExtractTool } from "./src/tavily-extract-tool.js";
import { createTavilyMapTool } from "./src/tavily-map-tool.js";
import { createTavilyWebSearchProvider } from "./src/tavily-search-provider.js";
import { createTavilySearchTool } from "./src/tavily-search-tool.js";

export default definePluginEntry({
  id: "tavily",
  name: "Tavily Plugin",
  description: "Bundled Tavily search, extract, crawl and map plugin",
  register(api) {
    api.registerTool((ctx) => createTavilyCrawlTool(api, ctx), { name: "tavily_crawl" });
    api.registerTool((ctx) => createTavilyMapTool(api, ctx), { name: "tavily_map" });
    api.registerWebSearchProvider(createTavilyWebSearchProvider());
    api.registerTool((ctx) => createTavilySearchTool(api, ctx), { name: "tavily_search" });
    api.registerTool((ctx) => createTavilyExtractTool(api, ctx), { name: "tavily_extract" });
  },
});
