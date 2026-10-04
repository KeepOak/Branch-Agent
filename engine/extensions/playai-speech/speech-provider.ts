import { normalizeResolvedSecretInputString } from "branch/plugin-sdk/secret-input";
import type {
  SpeechProviderConfig,
  SpeechProviderPlugin,
  SpeechSynthesisRequest,
} from "branch/plugin-sdk/speech-provider";
import { resolveSpeechProviderApiKey } from "branch/plugin-sdk/speech-provider";
import {
  asOptionalRecord,
  normalizeOptionalString as trim,
} from "branch/plugin-sdk/string-coerce-runtime";
import {
  DEFAULT_PLAYAI_MODEL,
  DEFAULT_PLAYAI_VOICE,
  PLAYAI_MODELS,
  PLAYAI_VOICES,
  openPlayAIStream,
  playAITTS,
} from "./src/client.js";

type Config = { apiKey?: string; userId?: string; model: string; voice: string };
function readConfig(raw: SpeechProviderConfig, path = "tts.providers.playai-speech"): Config {
  return {
    apiKey: normalizeResolvedSecretInputString({ value: raw.apiKey, path: `${path}.apiKey` }),
    userId: normalizeResolvedSecretInputString({ value: raw.userId, path: `${path}.userId` }),
    model: trim(raw.model ?? raw.modelId) ?? DEFAULT_PLAYAI_MODEL,
    voice: trim(raw.voice ?? raw.voiceId ?? raw.speaker) ?? DEFAULT_PLAYAI_VOICE,
  };
}
function rawConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const providers = asOptionalRecord(raw.providers);
  return (
    asOptionalRecord(providers?.["playai-speech"]) ??
    asOptionalRecord(providers?.playai) ??
    asOptionalRecord(raw["playai-speech"]) ??
    asOptionalRecord(raw.playai) ??
    {}
  );
}
function credentials(config: Config) {
  return {
    apiKey: resolveSpeechProviderApiKey(config.apiKey, trim(process.env.PLAYAI_API_KEY)),
    userId: trim(config.userId) ?? trim(process.env.PLAYAI_USER_ID),
  };
}
async function request(req: SpeechSynthesisRequest & { signal?: AbortSignal }) {
  const config = readConfig(req.providerConfig);
  const auth = credentials(config);
  if (!auth.apiKey) {
    throw new Error("PlayAI API key missing");
  }
  if (!auth.userId) {
    throw new Error("PlayAI userId missing");
  }
  const { resolveGeneratedMediaMaxBytes } =
    await import("branch/plugin-sdk/media-generation-runtime");
  return {
    text: req.text,
    apiKey: auth.apiKey,
    userId: auth.userId,
    model: trim(req.providerOverrides?.model ?? req.providerOverrides?.modelId) ?? config.model,
    voice:
      trim(
        req.providerOverrides?.voice ??
          req.providerOverrides?.voiceId ??
          req.providerOverrides?.speaker,
      ) ?? config.voice,
    timeoutMs: req.timeoutMs,
    signal: req.signal,
    maxBytes: resolveGeneratedMediaMaxBytes(req.cfg, "audio"),
  };
}
export function buildPlayAISpeechProvider(): SpeechProviderPlugin {
  return {
    id: "playai-speech",
    label: "PlayAI",
    aliases: ["playai"],
    defaultModel: DEFAULT_PLAYAI_MODEL,
    models: [...PLAYAI_MODELS],
    voices: PLAYAI_VOICES.map((voice) => voice.id),
    resolveConfig: ({ rawConfig: raw }) => readConfig(rawConfig(raw)),
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = readConfig(rawConfig(baseTtsConfig));
      const talk = asOptionalRecord(talkProviderConfig) ?? {};
      return readConfig(
        {
          ...base,
          apiKey: talk.apiKey === undefined ? base.apiKey : talk.apiKey,
          userId: talk.userId === undefined ? base.userId : talk.userId,
          model: trim(talk.modelId ?? talk.model) ?? base.model,
          voice: trim(talk.voiceId ?? talk.voice) ?? base.voice,
        },
        "talk.providers.playai-speech",
      );
    },
    resolveTalkOverrides: ({ params }) => ({
      ...(trim(params.voiceId) ? { voice: trim(params.voiceId) } : {}),
      ...(trim(params.modelId) ? { model: trim(params.modelId) } : {}),
    }),
    parseDirectiveToken: (ctx) => {
      if (["voice", "voiceid", "voice_id", "playai_voice", "speaker"].includes(ctx.key)) {
        return {
          handled: true,
          ...(ctx.policy.allowVoice
            ? { overrides: { ...ctx.currentOverrides, voice: ctx.value } }
            : {}),
        };
      }
      if (["model", "modelid", "model_id", "playai_model"].includes(ctx.key)) {
        if (!ctx.policy.allowModelId) {
          return { handled: true };
        }
        if (!PLAYAI_MODELS.some((model) => model === ctx.value)) {
          return { handled: true, warnings: ["Invalid PlayAI speech model"] };
        }
        return { handled: true, overrides: { ...ctx.currentOverrides, model: ctx.value } };
      }
      return { handled: false };
    },
    listVoices: async () =>
      PLAYAI_VOICES.map((voice) => ({
        id: voice.id,
        name: voice.name,
        gender: voice.gender,
        description: `${voice.accent}, ${voice.age}, ${voice.style}`,
      })),
    isConfigured: ({ providerConfig }) => {
      const auth = credentials(readConfig(providerConfig));
      return Boolean(auth.apiKey && auth.userId);
    },
    synthesize: async (req) => playAITTS(await request(req)),
    streamSynthesize: async (req) => {
      const { audioStream, release, outputFormat, fileExtension, voiceCompatible } =
        await openPlayAIStream(await request(req));
      return { audioStream, release, outputFormat, fileExtension, voiceCompatible };
    },
  };
}
