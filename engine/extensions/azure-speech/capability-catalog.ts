import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildAzureSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildAzureSpeechProvider()],
} satisfies PluginCapabilityCatalog;
