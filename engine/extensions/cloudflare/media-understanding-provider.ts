import type { MediaUnderstandingProvider } from "branch/plugin-sdk/media-understanding";
import { DEFAULT_CLOUDFLARE_AUDIO_MODEL, transcribeCloudflareAudio } from "./audio-transcription.js";

export const cloudflareMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "cloudflare",
  capabilities: ["audio"],
  defaultModels: { audio: DEFAULT_CLOUDFLARE_AUDIO_MODEL },
  resolveAuth: ({ providerConfig }) => {
    // Leave configured keys and SecretRefs to the host's normal auth resolver.
    if (providerConfig?.apiKey) {
      return undefined;
    }
    const apiKey = process.env.CLOUDFLARE_AI_API_KEY?.trim();
    return apiKey
      ? { kind: "api-key", apiKey, source: "env: CLOUDFLARE_AI_API_KEY" }
      : undefined;
  },
  transcribeAudio: transcribeCloudflareAudio,
};
