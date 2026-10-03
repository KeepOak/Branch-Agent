import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildMicrosoftSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildMicrosoftSpeechProvider()],
} satisfies PluginCapabilityCatalog;
