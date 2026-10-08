import type { MediaUnderstandingProvider } from "branch/plugin-sdk/media-understanding";
import { normalizeResolvedSecretInputString } from "branch/plugin-sdk/secret-input";
import { sarvamSpeechToText } from "./src/client.js";
export const sarvamMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "sarvam-speech",
  capabilities: ["audio"],
  defaultModels: { audio: "saarika:v2.5" },
  resolveAuth: ({ providerConfig }) => {
    const configured = normalizeResolvedSecretInputString({
      value: providerConfig?.apiKey,
      path: "models.providers.sarvam-speech.apiKey",
    });
    const apiKey = configured ?? process.env.SARVAM_API_KEY?.trim();
    return apiKey
      ? {
          kind: "api-key",
          apiKey,
          source: configured ? "models.providers.sarvam-speech.apiKey" : "env:SARVAM_API_KEY",
        }
      : undefined;
  },
  transcribeAudio: (req) =>
    sarvamSpeechToText({
      ...req,
      apiKey:
        req.auth?.kind === "api-key"
          ? req.auth.apiKey
          : req.auth?.kind === "none"
            ? ""
            : req.apiKey,
      languageCode: req.language ?? req.query?.languageCode ?? req.query?.language_code,
      filetype: req.query?.filetype ?? (req.mime === "audio/mpeg" ? "mp3" : "wav"),
      mode: req.query?.mode,
    }),
};
