import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createInfoQuestWebFetchProvider } from "./src/fetch-provider.js";
import { createInfoQuestImageSearchTool } from "./src/image-search-tool.js";
import { createInfoQuestWebSearchProvider } from "./src/search-provider.js";
export default definePluginEntry({
  id: "infoquest",
  name: "InfoQuest",
  description: "BytePlus InfoQuest web search, crawl and image search",
  register(api) {
    api.registerWebSearchProvider(createInfoQuestWebSearchProvider());
    api.registerWebFetchProvider(createInfoQuestWebFetchProvider());
    api.registerTool(
      {
        contextVersion: 2,
        create: (ctx) => createInfoQuestImageSearchTool(api, ctx.assertInvocationCurrent),
      },
      { names: ["infoquest_image_search"] },
    );
  },
});

export { createInfoQuestWebSearchProvider } from "./src/search-provider.js";
export { createInfoQuestWebFetchProvider } from "./src/fetch-provider.js";
