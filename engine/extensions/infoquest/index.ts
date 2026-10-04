import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createInfoQuestFetchProvider } from "./src/fetch-provider.js";
import { createInfoQuestImageSearchTool } from "./src/image-search-tool.js";
import { createInfoQuestSearchProvider } from "./src/search-provider.js";
export default definePluginEntry({
  id: "infoquest",
  name: "InfoQuest",
  description: "BytePlus InfoQuest web search, crawl and image search",
  register(api) {
    api.registerWebSearchProvider(createInfoQuestSearchProvider());
    api.registerWebFetchProvider(createInfoQuestFetchProvider());
    api.registerTool(
      {
        contextVersion: 2,
        create: (ctx) => createInfoQuestImageSearchTool(api, ctx.assertInvocationCurrent),
      },
      { names: ["infoquest_image_search"] },
    );
  },
});
