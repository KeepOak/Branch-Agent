import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildVolcengineSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildVolcengineSpeechProvider()],
} satisfies PluginCapabilityCatalog;
