import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildFishAudioSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildFishAudioSpeechProvider()],
} satisfies PluginCapabilityCatalog;
