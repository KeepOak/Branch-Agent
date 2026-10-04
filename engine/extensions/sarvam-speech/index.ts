import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { sarvamMediaUnderstandingProvider } from "./media-understanding-provider.js";
import { buildSarvamSpeechProvider } from "./speech-provider.js";
export default definePluginEntry({
  id: "sarvam-speech",
  name: "Sarvam Speech",
  description: "Bundled Sarvam speech synthesis and transcription",
  register(api) {
    api.registerSpeechProvider(buildSarvamSpeechProvider());
    api.registerMediaUnderstandingProvider(sarvamMediaUnderstandingProvider);
  },
});
