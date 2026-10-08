import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createSofyaFetchProvider } from "./src/fetch-provider.js";
import { createSofyaSearchProvider } from "./src/search-provider.js";

export default definePluginEntry({
  id: "sofya",
  name: "Sofya",
  description: "Sofya full-content web search and Markdown fetch",
  register(api) {
    api.registerWebSearchProvider(createSofyaSearchProvider());
    api.registerWebFetchProvider(createSofyaFetchProvider());
  },
});
