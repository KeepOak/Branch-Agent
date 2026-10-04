import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildPlayAISpeechProvider } from "./speech-provider.js";

export default { speechProviders: [buildPlayAISpeechProvider()] } satisfies PluginCapabilityCatalog;
