import { normalizeResolvedSecretInputString } from "branch/plugin-sdk/secret-input";
import type { SpeechProviderPlugin, SpeechSynthesisRequest } from "branch/plugin-sdk/speech-core";
import { resolveSpeechProviderApiKey } from "branch/plugin-sdk/speech-provider";
import {
  asOptionalRecord,
  asFiniteNumber,
  normalizeOptionalString as trim,
} from "branch/plugin-sdk/string-coerce-runtime";
import { MODELSLAB_VOICES, POLL_TIMEOUT_MS, modelsLabTTS } from "./src/client.js";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function configRecord(rawConfig: Record<string, unknown>) {
  const providers = asOptionalRecord(rawConfig.providers);
  return (
    asOptionalRecord(providers?.modelslab) ??
    asOptionalRecord(providers?.["modelslab-speech"]) ??
    asOptionalRecord(rawConfig.modelslab) ??
    asOptionalRecord(rawConfig["modelslab-speech"])
  );
}
function normalizeConfig(rawConfig: Record<string, unknown>) {
  const raw = configRecord(rawConfig);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw?.apiKey,
      path: "tts.providers.modelslab.apiKey",
    }),
    voice: stringValue(raw?.voice ?? raw?.voiceId ?? raw?.speaker) ?? "1",
    language: stringValue(raw?.language) ?? "english",
    speed: asFiniteNumber(raw?.speed) ?? 1,
    timeoutMs: asFiniteNumber(raw?.timeoutMs),
  };
}
function apiKey(value?: string) {
  return resolveSpeechProviderApiKey(value, trim(process.env.MODELSLAB_API_KEY));
}
export function buildModelsLabSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "modelslab",
    label: "ModelsLab",
    defaultTimeoutMs: POLL_TIMEOUT_MS,
    aliases: ["modelslab-speech"],
    resolveConfig: ({ rawConfig }) => normalizeConfig(rawConfig),
    isConfigured: ({ providerConfig }) => Boolean(apiKey(trim(providerConfig.apiKey))),
    listVoices: async () =>
      MODELSLAB_VOICES.map((voice) => ({
        id: voice.voiceId,
        name: voice.name,
        locale: voice.language,
        gender: voice.gender,
      })),
    parseDirectiveToken: (ctx) => {
      const field = ["voice", "voiceid", "voice_id", "speaker"].includes(ctx.key)
        ? "voice"
        : ctx.key === "language" || ctx.key === "lang"
          ? "language"
          : ctx.key === "speed"
            ? "speed"
            : undefined;
      if (!field) {
        return { handled: false };
      }
      if (!(field === "voice" ? ctx.policy.allowVoice : ctx.policy.allowVoiceSettings)) {
        return { handled: true };
      }
      const value = field === "speed" ? Number(ctx.value) : ctx.value;
      if (typeof value === "number" && !Number.isFinite(value)) {
        return { handled: true, warnings: ["ModelsLab speed must be finite"] };
      }
      return { handled: true, overrides: { ...ctx.currentOverrides, [field]: value } };
    },
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => ({
      ...normalizeConfig(baseTtsConfig),
      ...(talkProviderConfig.apiKey !== undefined
        ? {
            apiKey: normalizeResolvedSecretInputString({
              value: talkProviderConfig.apiKey,
              path: "talk.providers.modelslab.apiKey",
            }),
          }
        : {}),
      ...(trim(talkProviderConfig.voiceId) ? { voice: trim(talkProviderConfig.voiceId) } : {}),
    }),
    resolveTalkOverrides: ({ params }) => ({
      ...(trim(params.voiceId ?? params.speaker)
        ? { voice: trim(params.voiceId ?? params.speaker) }
        : {}),
      ...(trim(params.language) ? { language: trim(params.language) } : {}),
      ...(asFiniteNumber(params.speed) !== undefined
        ? { speed: asFiniteNumber(params.speed) }
        : {}),
    }),
    synthesize: async (req: SpeechSynthesisRequest & { signal?: AbortSignal }) => {
      const startedAtMs = Date.now();
      req.signal?.throwIfAborted();
      const config = req.providerConfig;
      const overrides = req.providerOverrides;
      const key = apiKey(trim(config.apiKey));
      if (!key) {
        throw new Error("MODELSLAB_API_KEY is not set");
      }
      const { resolveGeneratedMediaMaxBytes } =
        await import("branch/plugin-sdk/media-generation-runtime");
      const configuredTimeout = asFiniteNumber(config.timeoutMs);
      const budget =
        configuredTimeout && configuredTimeout > 0
          ? Math.min(configuredTimeout, req.timeoutMs)
          : req.timeoutMs;
      const timeoutMs = budget - (Date.now() - startedAtMs);
      if (timeoutMs <= 0) {
        throw new Error(`ModelsLab TTS timed out after ${budget}ms`);
      }
      return await modelsLabTTS({
        text: req.text,
        apiKey: key,
        speaker:
          stringValue(overrides?.voice ?? overrides?.voiceId ?? overrides?.speaker) ??
          stringValue(config.voice ?? config.voiceId ?? config.speaker),
        language:
          stringValue(overrides?.language ?? overrides?.lang) ?? stringValue(config.language),
        speed: asFiniteNumber(overrides?.speed) ?? asFiniteNumber(config.speed),
        timeoutMs,
        maxBytes: resolveGeneratedMediaMaxBytes(req.cfg, "audio"),
        signal: req.signal,
      });
    },
  };
}
