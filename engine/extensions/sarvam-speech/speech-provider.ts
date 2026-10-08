import { normalizeResolvedSecretInputString } from "branch/plugin-sdk/secret-input";
import {
  resolveSpeechProviderApiKey,
  type SpeechProviderPlugin,
} from "branch/plugin-sdk/speech-provider";
import { asOptionalRecord, normalizeOptionalString } from "branch/plugin-sdk/string-coerce-runtime";
import {
  buildSarvamSpeechPayload,
  SARVAM_PROPERTY_KEYS,
  sarvamTextToSpeech,
} from "./src/client.js";
import { SARVAM_TTS_MODELS, SARVAM_VOICES } from "./src/voices.js";

function config(
  raw: Record<string, unknown>,
  path = "tts.providers.sarvam-speech.apiKey",
): Record<string, unknown> & { apiKey?: string } {
  return { ...raw, apiKey: normalizeResolvedSecretInputString({ value: raw.apiKey, path }) };
}
export function buildSarvamSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "sarvam-speech",
    label: "Sarvam Speech",
    aliases: ["sarvam"],
    defaultModel: "bulbul:v3",
    models: SARVAM_TTS_MODELS,
    voices: SARVAM_VOICES,
    resolveConfig: ({ rawConfig }) => {
      const providers = asOptionalRecord(rawConfig.providers);
      return config(
        asOptionalRecord(providers?.["sarvam-speech"]) ??
          asOptionalRecord(providers?.sarvam) ??
          asOptionalRecord(rawConfig["sarvam-speech"]) ??
          asOptionalRecord(rawConfig.sarvam) ??
          {},
      );
    },
    isConfigured: ({ providerConfig }) =>
      Boolean(
        resolveSpeechProviderApiKey(config(providerConfig).apiKey, process.env.SARVAM_API_KEY),
      ),
    listVoices: async () => SARVAM_VOICES.map((id) => ({ id })),
    parseDirectiveToken: ({ key, value, policy, currentOverrides }) => {
      const field =
        (
          {
            voice: "speaker",
            voiceid: "speaker",
            voice_id: "speaker",
            speaker: "speaker",
            model: "model",
            modelid: "model",
            model_id: "model",
            language: "language",
            lang: "language",
          } as Record<string, string>
        )[key] ??
        (SARVAM_PROPERTY_KEYS.includes(key as (typeof SARVAM_PROPERTY_KEYS)[number])
          ? key
          : undefined);
      if (!field) {
        return { handled: false };
      }
      const allowed =
        field === "speaker"
          ? policy.allowVoice
          : field === "model"
            ? policy.allowModelId
            : policy.allowVoiceSettings;
      if (!allowed) {
        return { handled: true };
      }
      const numeric = ["pace", "temperature", "pitch", "loudness", "speech_sample_rate"].includes(
        field,
      );
      const parsed = numeric
        ? Number(value)
        : field === "enable_preprocessing"
          ? value === "true"
            ? true
            : value === "false"
              ? false
              : value
          : value;
      return { handled: true, overrides: { ...currentOverrides, [field]: parsed } };
    },
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const providers = asOptionalRecord(baseTtsConfig.providers);
      const base = config(
        asOptionalRecord(providers?.["sarvam-speech"]) ?? asOptionalRecord(providers?.sarvam) ?? {},
      );
      const talk = config(talkProviderConfig, "talk.providers.sarvam-speech.apiKey");
      return {
        ...base,
        ...talk,
        apiKey: talk.apiKey ?? base.apiKey,
        model: talkProviderConfig.modelId ?? talkProviderConfig.model ?? base.model ?? base.modelId,
        language:
          talkProviderConfig.languageCode ??
          talkProviderConfig.language ??
          base.language ??
          base.languageCode,
        speaker: talkProviderConfig.voiceId ?? talkProviderConfig.speaker ?? base.speaker,
      };
    },
    resolveTalkOverrides: ({ params }) => ({
      ...params,
      speaker: params.voiceId ?? params.speaker,
      model: params.modelId ?? params.model,
    }),
    synthesize: async (req) => {
      const normalized = config(req.providerConfig);
      const apiKey = resolveSpeechProviderApiKey(normalized.apiKey, process.env.SARVAM_API_KEY);
      if (!apiKey) {
        throw new Error("SARVAM_API_KEY must be set");
      }
      const values = { ...normalized, ...req.providerOverrides };
      const properties = {
        ...asOptionalRecord(normalized.properties),
        ...asOptionalRecord(req.providerOverrides?.properties),
      };
      for (const key of SARVAM_PROPERTY_KEYS) {
        if (values[key] !== undefined) {
          properties[key] = values[key];
        }
      }
      if (properties.output_audio_codec === undefined && values.outputFormat !== undefined) {
        properties.output_audio_codec = values.outputFormat;
      }
      const payload = buildSarvamSpeechPayload({
        text: req.text,
        model:
          req.providerOverrides?.model ??
          req.providerOverrides?.modelId ??
          values.model ??
          values.modelId,
        language: values.language ?? values.languageCode ?? values.lang,
        speaker: values.speaker ?? values.voice ?? values.voiceId,
        properties,
      });
      const { resolveGeneratedMediaMaxBytes } =
        await import("branch/plugin-sdk/media-generation-runtime");
      const audioBuffer = await sarvamTextToSpeech({
        text: req.text,
        apiKey,
        baseUrl: normalizeOptionalString(normalized.baseUrl),
        model: payload.model,
        speaker: payload.speaker,
        language: payload.target_language_code,
        properties,
        timeoutMs: req.timeoutMs,
        maxBytes: resolveGeneratedMediaMaxBytes(req.cfg, "audio"),
        // Forward additive cancellation when the host supplies it. Current buffered TTS SDK has no signal field.
        signal: (req as typeof req & { signal?: AbortSignal }).signal,
      });
      const outputFormat =
        typeof properties.output_audio_codec === "string" ? properties.output_audio_codec : "wav";
      const fileExtension =
        (
          { linear16: ".pcm", mulaw: ".ulaw", alaw: ".alaw", opus: ".opus" } as Record<
            string,
            string
          >
        )[outputFormat] ?? `.${outputFormat}`;
      return { audioBuffer, outputFormat, fileExtension, voiceCompatible: false };
    },
  };
}
