import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { r2StorageProvider } from "./api.js";
import { cloudflareMediaUnderstandingProvider } from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "cloudflare",
  name: "Cloudflare",
  description: "Cloudflare R2 storage and Workers AI audio transcription.",
  register(api) {
    api.registerStorageProvider(r2StorageProvider);
    api.registerMediaUnderstandingProvider(cloudflareMediaUnderstandingProvider);
  },
});
