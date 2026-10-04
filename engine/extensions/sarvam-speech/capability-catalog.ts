import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";
import { buildSarvamSpeechProvider } from "./speech-provider.js";
// Media understanding is registered by index.ts. It is not a capability-catalog family in the host SDK.
export default { speechProviders: [buildSarvamSpeechProvider()] } satisfies PluginCapabilityCatalog;
