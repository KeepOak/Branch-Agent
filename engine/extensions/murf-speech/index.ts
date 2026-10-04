import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { buildMurfSpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "murf-speech",
  name: "Murf Speech",
  description: "Bundled Murf text-to-speech provider",
  register(api) {
    api.registerSpeechProvider(buildMurfSpeechProvider());
  },
});
