import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { gladiaMediaUnderstandingProvider } from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "gladia",
  name: "Gladia",
  description: "Bundled Gladia audio transcription provider",
  register(api) {
    api.registerMediaUnderstandingProvider(gladiaMediaUnderstandingProvider);
  },
});
