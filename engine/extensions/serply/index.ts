import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createSerplyWebSearchProvider } from "./src/search-provider.js";

export default definePluginEntry({
  id: "serply",
  name: "Serply Plugin",
  description: "Google web, News and Scholar search through Serply",
  register(api) {
    api.registerWebSearchProvider(createSerplyWebSearchProvider());
  },
});
