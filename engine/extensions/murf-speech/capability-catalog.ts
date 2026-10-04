import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildMurfSpeechProvider } from "./speech-provider.js";

export default { speechProviders: [buildMurfSpeechProvider()] } satisfies PluginCapabilityCatalog;
