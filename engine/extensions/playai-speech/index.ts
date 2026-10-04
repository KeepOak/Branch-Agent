import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { buildPlayAISpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "playai-speech",
  name: "PlayAI Speech",
  description: "Bundled PlayAI text-to-speech provider",
  register(api) {
    api.registerSpeechProvider(buildPlayAISpeechProvider());
  },
});
