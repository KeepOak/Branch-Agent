import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildCliSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildCliSpeechProvider()],
} satisfies PluginCapabilityCatalog;
