import type { PluginCapabilityCatalog } from "branch/plugin-sdk/plugin-entry";

// Media-understanding capabilities are registered by index.ts and declared in
// the manifest. The host catalog contract covers speech/realtime providers only.
export default {} satisfies PluginCapabilityCatalog;
