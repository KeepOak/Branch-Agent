import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildModelsLabSpeechProvider } from "./speech-provider.js";
export default {
  speechProviders: [buildModelsLabSpeechProvider()],
} satisfies PluginCapabilityCatalog;
