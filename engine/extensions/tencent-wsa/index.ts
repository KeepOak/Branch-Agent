import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createTencentWsaWebSearchProvider } from "./src/search-provider.js";

export default definePluginEntry({
  id: "tencent-wsa",
  name: "Tencent Cloud WSA",
  description: "Tencent Cloud SearchPro web search",
  register(api) {
    api.registerWebSearchProvider(createTencentWsaWebSearchProvider());
  },
});
