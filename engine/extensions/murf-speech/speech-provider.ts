import { normalizeResolvedSecretInputString } from "branch/plugin-sdk/secret-input";
import type { SpeechProviderPlugin } from "branch/plugin-sdk/speech-provider";
import {
  asOptionalRecord,
  normalizeOptionalString as trimToUndefined,
} from "branch/plugin-sdk/string-coerce-runtime";
import {
  DEFAULT_MURF_MODEL,
  DEFAULT_MURF_VOICE,
  synthesizeMurf,
  type MurfModel,
  type MurfProperties,
} from "./src/client.js";
import { MURF_VOICES } from "./src/voices.js";

function properties(value: unknown): MurfProperties {
  const raw = asOptionalRecord(value) ?? {};
  const result: Record<string, unknown> = {};
  for (const key of ["style", "multiNativeLocale"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string") {
        throw new Error(`Murf ${key} must be a string`);
      }
      result[key] = raw[key];
    }
  }
  for (const key of ["rate", "pitch", "variation", "audioDuration"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "number" || !Number.isFinite(raw[key])) {
        throw new Error(`Murf ${key} must be a finite number`);
      }
      result[key] = raw[key];
    }
  }
  for (const [key, allowed] of [
    ["format", ["MP3", "WAV", "FLAC", "ALAW", "ULAW"]],
    ["channelType", ["STEREO", "MONO"]],
    ["sampleRate", [8000, 24000, 44100, 48000]],
  ] as const) {
    if (raw[key] !== undefined) {
      if (!(allowed as readonly unknown[]).includes(raw[key])) {
        throw new Error(`Murf ${key} is unsupported`);
      }
      result[key] = raw[key];
    }
  }
  if (raw.encodeAsBase64 !== undefined) {
    if (typeof raw.encodeAsBase64 !== "boolean") {
      throw new Error("Murf encodeAsBase64 must be a boolean");
    }
    result.encodeAsBase64 = raw.encodeAsBase64;
  }
  if (raw.pronunciationDictionary !== undefined) {
    const dictionary = asOptionalRecord(raw.pronunciationDictionary);
    if (!dictionary || Object.values(dictionary).some((entry) => typeof entry !== "string")) {
      throw new Error("Murf pronunciationDictionary must contain strings");
    }
    result.pronunciationDictionary = dictionary;
  }
  return result as MurfProperties;
}

function normalizeConfig(raw: Record<string, unknown>) {
  const speechModel = asOptionalRecord(raw.speechModel);
  const configuredModel = trimToUndefined(
    raw.modelId ?? raw.model ?? raw.modelVersion ?? speechModel?.name,
  );
  const modelVersion = configuredModel ?? DEFAULT_MURF_MODEL;
  if (modelVersion !== "GEN1" && modelVersion !== "GEN2") {
    throw new Error("Murf modelVersion must be GEN1 or GEN2");
  }
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw.apiKey ?? speechModel?.apiKey,
      path: "tts.providers.murf-speech.apiKey",
    }),
    modelVersion: modelVersion as MurfModel,
    model: configuredModel,
    voiceId: trimToUndefined(raw.voiceId ?? raw.voice ?? raw.speaker) ?? DEFAULT_MURF_VOICE,
    properties: properties(raw.properties ?? speechModel?.properties),
  };
}

function configRecord(rawConfig: Record<string, unknown>) {
  const providers = asOptionalRecord(rawConfig.providers);
  return (
    asOptionalRecord(providers?.["murf-speech"]) ??
    asOptionalRecord(providers?.murf) ??
    asOptionalRecord(rawConfig["murf-speech"]) ??
    asOptionalRecord(rawConfig.murf) ??
    {}
  );
}

function resolveApiKey(value: string | undefined) {
  return value ?? trimToUndefined(process.env.MURF_API_KEY);
}

export function buildMurfSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "murf-speech",
    label: "Murf",
    aliases: ["murf"],
    defaultModel: DEFAULT_MURF_MODEL,
    models: ["GEN1", "GEN2"],
    voices: MURF_VOICES,
    resolveConfig: ({ rawConfig }) => normalizeConfig(configRecord(rawConfig)),
    isConfigured: ({ providerConfig }) =>
      Boolean(resolveApiKey(normalizeConfig(providerConfig).apiKey)),
    listVoices: async () =>
      MURF_VOICES.map((id) => ({ id, name: id, locale: id.split("-")[0], gender: "neutral" })),
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = normalizeConfig(configRecord(baseTtsConfig));
      return normalizeConfig({
        ...base,
        ...talkProviderConfig,
        voiceId: talkProviderConfig.voiceId ?? base.voiceId,
      });
    },
    resolveTalkOverrides: ({ params }) => ({
      ...(params.voiceId !== undefined ? { voiceId: params.voiceId } : {}),
      ...(params.modelId !== undefined
        ? { modelVersion: params.modelId, model: params.modelId }
        : {}),
      ...(params.properties !== undefined ? { properties: properties(params.properties) } : {}),
    }),
    parseDirectiveToken: (ctx) => {
      if (["voice", "voiceid", "voice_id", "speaker"].includes(ctx.key)) {
        return {
          handled: true,
          ...(ctx.policy.allowVoice
            ? { overrides: { ...ctx.currentOverrides, voiceId: ctx.value } }
            : {}),
        };
      }
      if (["model", "modelversion", "model_version"].includes(ctx.key)) {
        return {
          handled: true,
          ...(ctx.policy.allowModelId
            ? { overrides: { ...ctx.currentOverrides, modelVersion: ctx.value, model: ctx.value } }
            : {}),
        };
      }
      return { handled: false };
    },
    synthesize: async (req) => {
      const config = normalizeConfig(req.providerConfig);
      const apiKey = resolveApiKey(config.apiKey);
      if (!apiKey) {
        throw new Error("MURF_API_KEY is not set");
      }
      const overrides = req.providerOverrides ?? {};
      const selectedModel =
        overrides.modelVersion ?? overrides.modelId ?? overrides.model ?? config.modelVersion;
      const resolved = normalizeConfig({
        ...config,
        ...overrides,
        apiKey,
        voiceId: overrides.voiceId ?? overrides.voice ?? overrides.speaker ?? config.voiceId,
        modelVersion: selectedModel,
        model: selectedModel,
        modelId: selectedModel,
      });
      const { resolveGeneratedMediaMaxBytes } =
        await import("branch/plugin-sdk/media-generation-runtime");
      return synthesizeMurf({
        text: req.text,
        apiKey,
        modelVersion: resolved.modelVersion,
        voiceId: resolved.voiceId,
        properties: { ...config.properties, ...resolved.properties },
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        maxBytes: resolveGeneratedMediaMaxBytes(req.cfg, "audio"),
      });
    },
  };
}
