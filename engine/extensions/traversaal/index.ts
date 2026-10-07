import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createTraversaalWebSearchProvider } from "./src/provider.js";

export default definePluginEntry({
  id: "traversaal",
  name: "Traversaal Ares",
  description: "Traversaal Ares web search provider",
  register(api) {
    api.registerWebSearchProvider(createTraversaalWebSearchProvider());
  },
});
