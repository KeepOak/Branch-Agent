import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createGoogleSearchWebSearchProvider } from "./src/provider.js";

export default definePluginEntry({
  id: "google-search",
  name: "Google Custom Search",
  description: "Google Custom Search web search provider",
  register(api) {
    api.registerWebSearchProvider(createGoogleSearchWebSearchProvider());
  },
});
