import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createGroundRouteFetchProvider } from "./src/fetch-provider.js";
import { createGroundRouteSearchProvider } from "./src/search-provider.js";

export default definePluginEntry({
  id: "groundroute",
  name: "GroundRoute",
  description: "GroundRoute meta-search and page extraction",
  register(api) {
    api.registerWebSearchProvider(createGroundRouteSearchProvider());
    api.registerWebFetchProvider(createGroundRouteFetchProvider());
  },
});
