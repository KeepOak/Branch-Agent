import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildDeepInfraSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildDeepInfraSpeechProvider()],
} satisfies PluginCapabilityCatalog;
