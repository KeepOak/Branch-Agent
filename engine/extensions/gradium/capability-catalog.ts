import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildGradiumSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildGradiumSpeechProvider()],
} satisfies PluginCapabilityCatalog;
