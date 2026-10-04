import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { buildModelsLabSpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "modelslab-speech",
  name: "ModelsLab Speech",
  description: "Bundled ModelsLab text-to-speech provider",
  register(api) {
    api.registerSpeechProvider(buildModelsLabSpeechProvider());
  },
});
