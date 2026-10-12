import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildInworldSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildInworldSpeechProvider()],
} satisfies PluginCapabilityCatalog;
