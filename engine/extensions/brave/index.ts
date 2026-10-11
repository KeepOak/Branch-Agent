// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/brave/index.ts (atlas RESEARCH-0002). Changed for Branch: register DeerFlow image search as a native plugin tool.
/**
 * Brave Search plugin entry. It registers the Brave web-search provider and
 * keeps runtime HTTP execution lazy.
 */
import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createBraveImageSearchTool } from "./src/brave-image-search-tool.js";
import { createBraveWebSearchProvider } from "./src/brave-web-search-provider.js";

/** Plugin entry for Brave Search. */
export default definePluginEntry({
  id: "brave",
  name: "Brave Plugin",
  description: "Bundled Brave plugin",
  register(api) {
    api.registerTool((ctx) => createBraveImageSearchTool(api, ctx), { name: "brave_image_search" });
    api.registerWebSearchProvider(createBraveWebSearchProvider());
  },
});
